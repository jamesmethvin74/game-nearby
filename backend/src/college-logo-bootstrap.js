import { COLLEGE_SOURCE_PLATFORMS } from "./college-source-platforms.js";

export const COLLEGE_LOGO_BATCH_LIMIT = 8;

const PLATFORM_BY_SCHOOL = new Map(COLLEGE_SOURCE_PLATFORMS.map(row => [row.schoolId, row]));

const SOURCE_OVERRIDES = new Map([
  ["williams-baptist", ["https://williamsbu.edu/athletics/", "https://williamsbu.edu/"]],
  ["philander-smith", ["https://www.philander.edu/athletics", "https://www.philander.edu/"]],
  ["asu-mid-south", ["https://www.asumidsouthsports.com/landing/index", "https://www.asumidsouth.edu/athletics/", "https://www.asumidsouth.edu/"]],
  ["asu-mountain-home", ["https://asumhathletics.com/landing/index", "https://asumhathletics.com/", "https://asumh.edu/institution/logos-branding/", "https://asumh.edu/"]],
  ["asu-newport", ["https://asunaviators.com/landing/index", "https://asunaviators.com/", "https://www.asun.edu/", "https://asun.edu/"]],
  ["national-park", ["https://np.edu/"]],
  ["north-arkansas", ["https://www.northark.edu/athletics/", "https://www.northark.edu/"]],
  ["nwacc", ["https://www.nwacc.edu/"]],
  ["shorter", ["https://www.shortercollege.edu/"]],
  ["south-arkansas", ["https://www.southarkstars.com/", "https://www.southark.edu/"]],
  ["seark", ["https://www.seark.edu/"]],
  ["sau-tech", ["https://sautrockets.com/", "https://www.sautech.edu/"]],
  ["ua-rich-mountain", ["https://www.uarichmountain.edu/"]],
  ["ua-cossatot", ["https://www.cccua.edu/"]],
  ["champion-christian", ["https://champion.edu/"]]
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function attr(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return clean(match?.[1] ?? match?.[2] ?? "");
}

function absoluteHttpUrl(value, baseUrl) {
  const raw = clean(value).replace(/&amp;/g, "&");
  if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:")) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function jsonLdLogoCandidates(html, baseUrl) {
  const candidates = [];
  for (const match of String(html || "").matchAll(/<script\b[^>]*type=(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
      for (const item of values) {
        const logo = typeof item?.logo === "string" ? item.logo : item?.logo?.url || item?.logo?.contentUrl;
        const url = absoluteHttpUrl(logo, baseUrl);
        if (url) candidates.push({ url, score:100, method:"jsonld-logo" });
      }
    } catch {}
  }
  return candidates;
}

function socialImageLogoScore(url) {
  const signal = clean(url).toLowerCase();
  return /(?:^|[\/_\-.])(logo|brand|mascot|athletic|athletics|sports|school[-_ ]?mark)(?:[\/_\-.]|$)/.test(signal)
    ? 84
    : 40;
}

export function parseOfficialCollegeLogo(html, baseUrl) {
  const text = String(html || "");
  const candidates = jsonLdLogoCandidates(text, baseUrl);

  for (const match of text.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const src = attr(attrs, "src") || attr(attrs, "data-src") || attr(attrs, "data-lazy-src");
    const url = absoluteHttpUrl(src, baseUrl);
    if (!url) continue;
    const label = `${attr(attrs,"alt")} ${attr(attrs,"class")} ${attr(attrs,"id")} ${src}`.toLowerCase();
    let score = 35;
    if (/\b(athletic|athletics|mascot|primary)[-_ ]?logo\b|\blogo\b/.test(label)) score = 92;
    else if (/brand|header|site-mark|site-logo|school-mark/.test(label)) score = 82;
    if (/sponsor|advert|banner|hero|team-photo|gallery/.test(label)) score -= 35;
    candidates.push({ url, score, method:"img" });
  }

  for (const match of text.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1];
    const key = (attr(attrs,"property") || attr(attrs,"name")).toLowerCase();
    if (key !== "og:image" && key !== "twitter:image") continue;
    const url = absoluteHttpUrl(attr(attrs,"content"), baseUrl);
    if (url) candidates.push({ url, score:socialImageLogoScore(url), method:key });
  }

  for (const match of text.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    const rel = attr(attrs,"rel").toLowerCase();
    const url = absoluteHttpUrl(attr(attrs,"href"), baseUrl);
    if (!url) continue;
    if (rel.includes("apple-touch-icon")) candidates.push({ url, score:72, method:"apple-touch-icon" });
    else if (rel.includes("icon")) candidates.push({ url, score:45, method:"icon" });
  }

  const deduped = new Map();
  for (const candidate of candidates) {
    const current = deduped.get(candidate.url);
    if (!current || candidate.score > current.score) deduped.set(candidate.url, candidate);
  }
  const ranked = [...deduped.values()]
    .filter(candidate => candidate.score >= 60)
    .sort((a,b) => b.score - a.score || a.url.localeCompare(b.url));
  return ranked[0] || null;
}

export function collegeBrandingSourceUrls(schoolId) {
  const override = SOURCE_OVERRIDES.get(schoolId) || [];
  const platform = PLATFORM_BY_SCHOOL.get(schoolId);
  const inferred = [];
  if (platform?.status === "parser-ready" && platform.host) inferred.push(`https://${platform.host}/`);
  if (platform?.fallbackHost) inferred.push(`https://${platform.fallbackHost}/`);
  return [...new Set([...override, ...inferred])];
}

export function isAppRenderableLogoUrl(value) {
  try {
    return new URL(clean(value)).protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchLogoProbe(url, fetchFn, useRange) {
  const headers = { accept:"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" };
  if (useRange) headers.range = "bytes=0-4095";
  return fetchFn(url, { method:"GET", headers, redirect:"follow" });
}

export async function probeCollegeLogoUrl(value, fetchFn = fetch) {
  const url = clean(value);
  if (!isAppRenderableLogoUrl(url)) throw new Error("logo URL is not HTTPS");
  let response = await fetchLogoProbe(url, fetchFn, true);
  if (response.status === 403 || response.status === 405 || response.status === 416) {
    response = await fetchLogoProbe(url, fetchFn, false);
  }
  if (!response.ok) throw new Error(`logo HTTP ${response.status}`);
  const contentType = clean(response.headers?.get?.("content-type")).toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error(`logo content-type ${contentType || "missing"}`);
  const finalUrl = clean(response.url) || url;
  if (!isAppRenderableLogoUrl(finalUrl)) throw new Error("logo redirected away from HTTPS");
  return { url:finalUrl, contentType, status:response.status };
}

async function discoverCollegeLogo(school, fetchFn) {
  const sourceUrls = collegeBrandingSourceUrls(school.id);
  const failures = [];
  for (const sourceUrl of sourceUrls) {
    try {
      const response = await fetchFn(sourceUrl, {
        headers: { "user-agent":"LocalBleachersAR-college-branding/1.0", accept:"text/html" },
        redirect:"follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const finalUrl = response.url || sourceUrl;
      const candidate = parseOfficialCollegeLogo(await response.text(), finalUrl);
      if (!candidate) throw new Error("no logo candidate");
      const probe = await probeCollegeLogoUrl(candidate.url, fetchFn);
      return {
        schoolId:school.id,
        mascot:school.mascot || null,
        logoUrl:probe.url,
        provider:"official-college",
        providerName:school.name,
        sourceUrl:finalUrl,
        matchMethod:`${candidate.method}+render-probe`,
        matchConfidence:Math.min(1, Math.max(0.6, candidate.score / 100)),
        status:"curated"
      };
    } catch (error) {
      failures.push({ sourceUrl, error:String(error?.message || error) });
    }
  }
  return { schoolId:school.id, failure: failures.length ? failures : [{ sourceUrl:null, error:"no branding source configured" }] };
}

function needsLogoRepair(row) {
  const schoolLogo = clean(row.school_logo_url);
  const brandLogo = clean(row.brand_logo_url);
  return !isAppRenderableLogoUrl(schoolLogo) || !isAppRenderableLogoUrl(brandLogo) || schoolLogo !== brandLogo;
}

export async function runCollegeLogoCompletion(env, {
  fetchFn = fetch,
  now = new Date(),
  limit = COLLEGE_LOGO_BATCH_LIMIT,
  schoolIds = null
} = {}) {
  const checkedAt = now.toISOString();
  const safeLimit = Math.max(1, Math.min(COLLEGE_LOGO_BATCH_LIMIT, Number(limit) || COLLEGE_LOGO_BATCH_LIMIT));
  const { results: colleges } = await env.DB.prepare(`
    SELECT s.id,s.name,s.city,s.state,s.level,s.mascot,
      s.logo_url AS school_logo_url,b.logo_url AS brand_logo_url,b.status AS brand_status
    FROM schools s
    LEFT JOIN school_brand_assets b ON b.school_id=s.id
    WHERE s.catalog_scope='local' AND s.level='college'
      AND s.id <> 'asu-three-rivers'
    ORDER BY s.id
  `).all();

  const missing = colleges.filter(needsLogoRepair);
  let targets = missing;
  if (Array.isArray(schoolIds) && schoolIds.length) {
    const wanted = new Set(schoolIds.map(String));
    targets = colleges.filter(row => wanted.has(row.id));
  }
  targets = targets.slice(0, safeLimit);
  if (!targets.length) return { status:"COMPLETE", missingBefore:missing.length, attempted:0, written:0, failures:[] };

  const outcomes = await Promise.all(targets.map(row => discoverCollegeLogo(row, fetchFn)));
  const rows = outcomes.filter(row => !row.failure);
  const failures = outcomes.filter(row => row.failure).map(row => ({ schoolId:row.schoolId, attempts:row.failure }));
  if (!rows.length) return { status:"PARTIAL", missingBefore:missing.length, attempted:targets.length, written:0, failures };

  const payload = JSON.stringify(rows);
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO school_brand_assets
        (school_id,mascot,logo_url,provider,provider_name,source_url,match_method,match_confidence,status,last_checked_at,verified_at,updated_at)
      SELECT
        json_extract(value,'$.schoolId'),json_extract(value,'$.mascot'),json_extract(value,'$.logoUrl'),
        json_extract(value,'$.provider'),json_extract(value,'$.providerName'),json_extract(value,'$.sourceUrl'),
        json_extract(value,'$.matchMethod'),CAST(json_extract(value,'$.matchConfidence') AS REAL),
        'curated',?,?,?
      FROM json_each(?) WHERE 1
      ON CONFLICT(school_id) DO UPDATE SET
        mascot=COALESCE(excluded.mascot,school_brand_assets.mascot),logo_url=excluded.logo_url,
        provider=excluded.provider,provider_name=excluded.provider_name,source_url=excluded.source_url,
        match_method=excluded.match_method,match_confidence=excluded.match_confidence,status='curated',
        last_checked_at=excluded.last_checked_at,verified_at=excluded.verified_at,updated_at=excluded.updated_at
    `).bind(checkedAt, checkedAt, checkedAt, payload),
    env.DB.prepare(`
      UPDATE schools SET
        logo_url=(SELECT json_extract(value,'$.logoUrl') FROM json_each(?) WHERE json_extract(value,'$.schoolId')=schools.id LIMIT 1),
        mascot=COALESCE((SELECT json_extract(value,'$.mascot') FROM json_each(?) WHERE json_extract(value,'$.schoolId')=schools.id LIMIT 1),mascot),
        updated_at=?
      WHERE id IN (SELECT json_extract(value,'$.schoolId') FROM json_each(?))
    `).bind(payload, payload, checkedAt, payload)
  ]);
  const meta = results.map(result => result?.meta || {});
  return {
    status: failures.length ? "PARTIAL" : "SUCCESS",
    missingBefore:missing.length,
    attempted:targets.length,
    written:rows.length,
    failures,
    rowsRead:meta.reduce((sum,row) => sum + Number(row.rows_read || 0),0),
    rowsWritten:meta.reduce((sum,row) => sum + Number(row.rows_written || 0),0)
  };
}
