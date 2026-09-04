import { cleanText, stableKeys } from "./parser-core.js";

export const PRESTO_RSS_SPORT = Object.freeze({
  "basketball|men": { code:"mbkb", category:"Men's Basketball" },
  "basketball|women": { code:"wbkb", category:"Women's Basketball" },
  "soccer|men": { code:"msoc", category:"Men's Soccer" },
  "soccer|women": { code:"wsoc", category:"Women's Soccer" },
  "volleyball|women": { code:"wvball", category:"Women's Volleyball" }
});

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function stripMarkup(value) {
  return cleanText(decodeXml(value).replace(/<[^>]+>/g, " "));
}

function field(item, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = item.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (match) return stripMarkup(match[1]);
  if (new RegExp(`<${escaped}\\s*\\/>`, "i").test(item)) return "";
  return "";
}

function targetSeasonPath(source, meta) {
  const start = Number(source.season);
  if (!Number.isInteger(start)) throw new Error(`Invalid college season ${source.season}`);
  return `/sports/${meta.code}/${start}-${String(start + 1).slice(-2)}/schedule`;
}

function prestoResult(scoreText) {
  const value = cleanText(scoreText);
  if (!value) return { status:"SCHEDULED", teamScore:null, opponentScore:null, result:null };
  if (/cancel(?:ed|led)/i.test(value)) return { status:"CANCELED", teamScore:null, opponentScore:null, result:null };
  if (/postpon/i.test(value)) return { status:"POSTPONED", teamScore:null, opponentScore:null, result:null };
  const match = value.match(/^([WLT])\s*,?\s*(\d+)\s*[-–]\s*(\d+)$/i);
  if (!match) return { status:"SCHEDULED", teamScore:null, opponentScore:null, result:null };
  const result = match[1].toUpperCase();
  const first = Number(match[2]);
  const second = Number(match[3]);
  // Presto expresses losses winner-first (for example L, 5-1 means the
  // reporting team scored 1). Wins/ties already read from the team perspective.
  const teamScore = result === "L" ? second : first;
  const opponentScore = result === "L" ? first : second;
  return { status:"FINAL", teamScore, opponentScore, result };
}

function opponentParts(rawOpponent, source) {
  let value = cleanText(rawOpponent);
  let homeAway = "home";
  let venue = "";
  if (/^at\s+/i.test(value)) {
    homeAway = "away";
    value = value.replace(/^at\s+/i, "");
  } else if (/^vs\.?\s+/i.test(value)) {
    homeAway = "neutral";
    value = value.replace(/^vs\.?\s+/i, "");
    const site = value.match(/\s+@\s+(.+)$/i);
    if (site) {
      venue = cleanText(site[1]);
      value = cleanText(value.slice(0, site.index));
    }
  }
  if (homeAway === "home") venue = cleanText(source.home_venue);
  return { opponent:value, homeAway, venue };
}

function eventDate(item, description) {
  const exact = field(item, "dc:date");
  if (exact && Number.isFinite(Date.parse(exact))) return new Date(exact).toISOString();
  const pub = field(item, "pubDate");
  if (pub && Number.isFinite(Date.parse(pub))) return new Date(pub).toISOString();
  const match = cleanText(description).match(/\bon\s+(.+?)\s*:\s*/i);
  if (match && Number.isFinite(Date.parse(match[1]))) return new Date(match[1]).toISOString();
  return null;
}

export function normalizePrestoSportsRss(xml, source) {
  const meta = PRESTO_RSS_SPORT[`${source.sport}|${source.gender}`];
  if (!meta) throw new Error(`Unsupported Presto RSS sport ${source.sport}:${source.gender}`);
  const seasonPath = targetSeasonPath(source, meta).toLowerCase();
  const items = [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(match => match[0]);
  const events = [];

  for (const item of items) {
    const category = field(item, "category");
    const link = field(item, "link");
    const description = field(item, "description");
    const rawOpponent = field(item, "ps:opponent");
    const combined = cleanText(`${field(item,"title")} ${description} ${rawOpponent} ${link}`);
    if (category !== meta.category) continue;
    if (!link.toLowerCase().includes(seasonPath)) continue;
    if (/\bJV\b/i.test(combined) || /\/\d{4}-\d{2}jv\//i.test(link)) continue;

    const scheduledAt = eventDate(item, description);
    if (!scheduledAt || !rawOpponent) continue;
    const { opponent, homeAway, venue } = opponentParts(rawOpponent, source);
    if (!opponent) continue;
    const result = prestoResult(field(item, "ps:score"));
    const nonCount = /\b(scrimmage|exhibition|jamboree)\b/i.test(combined);
    const nativeId = cleanText(link.split("#")[1] || field(item,"guid") || link);

    events.push({
      nativeId,
      opponent,
      scheduledAt,
      scheduledTimeKnown: !/\bTBA\b/i.test(description),
      venue,
      locationText:venue,
      latitude:homeAway === "home" ? (source.home_latitude ?? null) : null,
      longitude:homeAway === "home" ? (source.home_longitude ?? null) : null,
      homeAway,
      conferenceGame:0,
      countsForRecord:nonCount ? 0 : 1,
      ...result,
      notes:nonCount ? (combined.match(/\b(Scrimmage|Exhibition|Jamboree)\b/i)?.[0] || "") : "",
      sourceUpdatedAt:field(item,"dc:date") || null
    });
  }
  return stableKeys(events);
}
