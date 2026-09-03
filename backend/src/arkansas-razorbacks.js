import { cleanText, parseClock, parseMonthDay, parseResult, stableKeys, zonedIso } from "./parser-core.js";

const SPORT_SLUG = Object.freeze({
  "football|men": "m-footbl",
  "basketball|men": "m-baskbl",
  "basketball|women": "w-baskbl",
  "soccer|women": "w-soccer",
  "volleyball|women": "w-volley"
});

export function arkansasRazorbackScheduleUrl(team) {
  const sportSlug = SPORT_SLUG[`${team?.sport}|${team?.gender}`];
  if (!sportSlug) return null;
  return `https://arkansasrazorbacks.com/sport/${sportSlug}/schedule/`;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textFromHtml(value) {
  return cleanText(decodeEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
}

function classText(block, className) {
  const expression = new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  return textFromHtml(block.match(expression)?.[1] || "");
}

function opponentText(block) {
  const opponentBlock = block.match(/<[^>]+class=["'][^"']*\bopponent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
  return textFromHtml(opponentBlock);
}

function resultText(block) {
  const resultBlock = block.match(/<[^>]+class=["'][^"']*\bresults-container\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
  return textFromHtml(resultBlock);
}

function eventBlocks(html) {
  const marker = /<div\b[^>]*class=["'][^"']*\bitem\b[^"']*["'][^>]*>/gi;
  const starts = [];
  let match;
  while ((match = marker.exec(html))) starts.push(match.index);
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

function scheduledAt(dateText, timeText, source) {
  const parsedDate = parseMonthDay(dateText, source.season);
  if (!parsedDate) return null;
  const clock = parseClock(timeText);
  let year = parsedDate.year;
  if (source.sport === "basketball" && parsedDate.month <= 6) year += 1;
  return {
    scheduledAt: zonedIso({ year, month: parsedDate.month, day: parsedDate.day, hour: clock.hour, minute: clock.minute }, source.timezone || "America/Chicago"),
    timeKnown: clock.known
  };
}

export function normalizeArkansasRazorbackHtml(html, source) {
  const events = [];
  for (const block of eventBlocks(String(html || ""))) {
    const type = classText(block, "type").toLowerCase();
    const dateText = classText(block, "month");
    const timeText = classText(block, "time");
    const place = classText(block, "place");
    const schedule = scheduledAt(dateText, timeText, source);
    if (!schedule) continue;

    let opponent = opponentText(block).replace(/^(?:at|vs\.?)[\s:]+/i, "").replace(/^#\d+\s*/, "").trim();
    if (!opponent) continue;

    const homeAway = /away/.test(type) ? "away" : /neutral/.test(type) ? "neutral" : /home/.test(type) ? "home" : "unknown";
    const resultRaw = resultText(block);
    const parsed = parseResult(resultRaw);
    const fullText = textFromHtml(block);
    const nonCount = /\b(exhibition|scrimmage)\b/i.test(`${opponent} ${fullText}`);
    const venue = place || (homeAway === "home" ? cleanText(source.home_venue) : "");

    events.push({
      nativeId: `${dateText}|${opponent}|${homeAway}`,
      opponent,
      scheduledAt: schedule.scheduledAt,
      scheduledTimeKnown: schedule.timeKnown,
      venue,
      locationText: venue,
      latitude: homeAway === "home" ? source.home_latitude ?? null : null,
      longitude: homeAway === "home" ? source.home_longitude ?? null : null,
      homeAway,
      conferenceGame: 0,
      countsForRecord: nonCount ? 0 : 1,
      ...parsed,
      notes: nonCount ? (fullText.match(/\b(Exhibition|Scrimmage)\b/i)?.[0] || "") : ""
    });
  }
  return stableKeys(events);
}
