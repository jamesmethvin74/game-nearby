function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return clean(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, " ");
}

function attr(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? "");
}
function stripTags(value) { return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")); }
function absoluteUrl(value, baseUrl) {
  const raw = decodeHtml(value);
  if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:")) return "";
  try { const url = new URL(raw, baseUrl); return /^https?:$/.test(url.protocol) ? url.toString() : ""; } catch { return ""; }
}
function unwrapExternalUrl(value, baseUrl) {
  const resolved = absoluteUrl(value, baseUrl);
  if (!resolved) return "";
  try {
    const url = new URL(resolved);
    if (url.hostname.endsWith("maxpreps.com")) {
      for (const key of ["url", "u", "target", "redirect", "redirectUrl"]) {
        const candidate = url.searchParams.get(key);
        if (!candidate) continue;
        const unwrapped = absoluteUrl(candidate, resolved);
        if (unwrapped && !new URL(unwrapped).hostname.endsWith("maxpreps.com")) return unwrapped;
      }
      return "";
    }
    return resolved;
  } catch { return ""; }
}
export function parseMaxPrepsOfficialWebsite(html, pageUrl) {
  const candidates = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const label = stripTags(match[2]);
    const lower = `${label} ${attr(attrs, "aria-label")} ${attr(attrs, "title")}`.toLowerCase();
    let score = 0;
    if (/\bofficial\s+(school\s+)?website\b/.test(lower)) score = 100;
    else if (/\bschool\s+website\b/.test(lower)) score = 95;
    else if (/\bwebsite\b/.test(lower)) score = 85;
    else if (/\bvisit\s+school\b/.test(lower)) score = 80;
    if (!score) continue;
    const url = unwrapExternalUrl(attr(attrs, "href"), pageUrl);
    if (url) candidates.push({ url, score });
  }
  candidates.sort((a,b) => b.score-a.score);
  return candidates[0]?.url || "";
}
function normalizeWords(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean); }
function schoolTokens(hints={}) {
  const stop = new Set(["high","school","schools","academy","district","public","k","12","arkansas","ar"]);
  return [...new Set([hints.name,hints.sourceName].flatMap(normalizeWords).filter(token => token.length>2 && !stop.has(token)))];
}
function candidateScore({url,label,className,id}, tokens) {
  const hay = `${label} ${className} ${id} ${url}`.toLowerCase();
  let score = 0;
  if (/\b(?:school[-_ ]?)?logo\b/.test(hay)) score += 75;
  if (/\bbrand(?:ing)?\b/.test(hay)) score += 55;
  if (/\bcrest\b|\bemblem\b|\bmascot\b/.test(hay)) score += 45;
  if (/\bheader[-_ ]?logo\b|\bsite[-_ ]?logo\b|\bnavbar[-_ ]?logo\b/.test(hay)) score += 35;
  if (tokens.some(token => hay.includes(token))) score += 20;
  if (/favicon|apple-touch|social|facebook|twitter|instagram|youtube|icon[-_ ]?search|loader|spinner|avatar/.test(hay)) score -= 100;
  if (/hero|banner|slideshow|carousel|staff|student|photo|news|event/.test(hay) && !/logo|brand|crest|mascot/.test(hay)) score -= 60;
  return score;
}
export function parseOfficialSchoolLogo(html, baseUrl, hints={}) {
  const tokens = schoolTokens(hints), candidates=[], seen=new Set();
  const add = (raw,meta={}) => {
    const url=absoluteUrl(raw,baseUrl); if(!url||seen.has(url)) return; seen.add(url);
    const score=candidateScore({url,...meta},tokens); if(score>=70) candidates.push({url,score,...meta});
  };
  for (const match of String(html||"").matchAll(/<img\b([^>]*)>/gi)) {
    const attrs=match[1]; const label=attr(attrs,"alt")||attr(attrs,"title")||attr(attrs,"aria-label");
    const meta={label,className:attr(attrs,"class"),id:attr(attrs,"id")};
    for (const key of ["src","data-src","data-lazy-src"]) add(attr(attrs,key),meta);
    const srcset=attr(attrs,"srcset")||attr(attrs,"data-srcset"); if(srcset) for(const item of srcset.split(",")) add(item.trim().split(/\s+/)[0],meta);
  }
  for (const match of String(html||"").matchAll(/<source\b([^>]*)>/gi)) {
    const attrs=match[1], srcset=attr(attrs,"srcset"); if(!srcset) continue;
    for(const item of srcset.split(",")) add(item.trim().split(/\s+/)[0],{label:"",className:attr(attrs,"class"),id:attr(attrs,"id")});
  }
  candidates.sort((a,b)=>b.score-a.score);
  if(!candidates.length) return null;
  if(candidates.length>1 && candidates[0].score===candidates[1].score && candidates[0].url!==candidates[1].url) return null;
  return {logoUrl:candidates[0].url,method:"official-site-logo",confidence:Math.min(1,candidates[0].score/120)};
}
