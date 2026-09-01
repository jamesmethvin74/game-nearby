import { normalizeSchoolAlias } from "./schedule-authority-core.js";

export const MAXPREPS_ARKANSAS_SCHOOLS = "https://www.maxpreps.com/ar/schools/";
const SYNC_ID = "maxpreps:arkansas:school-branding";
const PROVIDER = "maxpreps";

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

function cityKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cityFromDescription(value) {
  return clean(value).split(",")[0].trim();
}

export function normalizeMaxPrepsLogoUrl(value, size = 256) {
  const raw = decodeHtml(value);
  if (!raw.startsWith("https://image.maxpreps.io/school-mascot/")) return "";
  try {
    const url = new URL(raw);
    url.searchParams.set("width", String(size));
    url.searchParams.set("height", String(size));
    url.searchParams.set("auto", "webp");
    url.searchParams.set("format", "pjpg");
    return url.toString();
  } catch {
    return "";
  }
}

export function parseMaxPrepsSchoolDirectory(html) {
  const text = String(html || "");
  const rows = [];
  const seen = new Set();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(anchorRe)) {
    const attrs = match[1];
    const body = match[2];
    const href = attr(attrs, "href");
    const image = body.match(/<img\b[^>]*\bsrc=(?:"(https:\/\/image\.maxpreps\.io\/school-mascot\/[^"]+)"|'(https:\/\/image\.maxpreps\.io\/school-mascot\/[^']+)')[^>]*>/i);
    const rawLogoUrl = image?.[1] ?? image?.[2] ?? "";
    const logoUrl = normalizeMaxPrepsLogoUrl(rawLogoUrl);
    if (!logoUrl) continue;
    const hrefId = href.match(/[?&]schoolid=([0-9a-f-]{36})/i)?.[1];
    const logoId = rawLogoUrl.match(/school-mascot\/(?:[0-9a-f]\/) {0}/i);
    const pathId = rawLogoUrl.match(/school-mascot\/(?:[0-9a-f]\/){3}([0-9a-f-]{36})\.(?:gif|png|jpe?g|webp)/i)?.[1];
    const externalSchoolId = String(hrefId || pathId || "").toLowerCase();
    if (!externalSchoolId) continue;
    const title = body.match(/<div\b[^>]*class=(?:"[^"]*\btitle\b[^"]*"|'[^']*\btitle\b[^']*')[^>]*>([^<]+)<\/div>/i);
    const description = body.match(/<div\b[^>]*class=(?:"[^"]*\bdescription\b[^"]*"|'[^']*\bdescription\b[^']*')[^>]*>([^<]+)<\/div>/i);
    const name = decodeHtml(title?.[1] || attr(attrs, "title"));
    const location = decodeHtml(description?.[1] || "");
    if (!name || !location || seen.has(externalSchoolId)) continue;
    seen.add(externalSchoolId);
    rows.push({
      externalSchoolId,
      name,
      city: cityFromDescription(location),
      location,
      logoUrl,
      sourceUrl: href.startsWith("http") ? href : `https://www.maxpreps.com${href}`
    });
  }
  return rows;
}

export function parseMaxPrepsSchoolPage(html) {
  const text = String(html || "");
  const mascot = decodeHtml(text.match(/<dt>\s*Mascot\s*<\/dt>\s*<dd>([^<]+)<\/dd>/i)?.[1] || "");
  const colorMatches = [...text.matchAll(/background-color:\s*#([0-9a-f]{6})/gi)].map(match => `#${match[1].toUpperCase()}`);
  return {
    mascot: mascot || null,
    primaryColor: colorMatches[0] || null,
    secondaryColor: colorMatches[1] || null
  };
}

export function matchMaxPrepsBranding(entries, schools, aliases = []) {
  const schoolById = new Map(schools.map(school => [school.id, school]));
  const idsByName = new Map();
  const addKey = (key, id) => {
    if (!key || !schoolById.has(id)) return;
    const ids = idsByName.get(key) || new Set();
    ids.add(id);
    idsByName.set(key, ids);
  };
  for (const school of schools) {
    addKey(normalizeSchoolAlias(school.location_matched_name || school.name), school.id);
    addKey(normalizeSchoolAlias(school.name), school.id);
  }
  for (const alias of aliases) addKey(normalizeSchoolAlias(alias.normalized_alias || alias.alias_text), alias.school_id);

  const matches = [];
  const ambiguous = [];
  const claimedSchools = new Set();
  for (const entry of entries) {
    const key = normalizeSchoolAlias(entry.name);
    let candidates = [...(idsByName.get(key) || [])].map(id => schoolById.get(id)).filter(Boolean);
    if (!candidates.length) continue;
    const entryCity = cityKey(entry.city);
    if (candidates.length > 1 && entryCity) {
      const cityMatches = candidates.filter(school => cityKey(school.city) === entryCity);
      if (cityMatches.length === 1) candidates = cityMatches;
    }
    if (candidates.length !== 1) {
      ambiguous.push({ entry, schoolIds: candidates.map(school => school.id) });
      continue;
    }
    const school = candidates[0];
    if (claimedSchools.has(school.id)) {
      ambiguous.push({ entry, schoolIds: [school.id] });
      continue;
    }
    claimedSchools.add(school.id);
    const cityAgrees = Boolean(entryCity && cityKey(school.city) === entryCity);
    matches.push({
      schoolId: school.id,
      entry,
      matchMethod: cityAgrees ? "normalized-name+city" : "normalized-name",
      confidence: cityAgrees ? 1 : 0.98
    });
  }
  const matchedIds = new Set(matches.map(match => match.schoolId));
  const unresolved = schools.filter(school => !matchedIds.has(school.id));
  return { matches, unresolved, ambiguous };
}

export async function ensureSchoolBrandingSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS school_brand_assets (
    school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    mascot TEXT, logo_url TEXT, primary_color TEXT, secondary_color TEXT,
    provider TEXT, external_school_id TEXT, source_url TEXT, match_method TEXT,
    match_confidence REAL,
    status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('matched','curated','unresolved')),
    last_checked_at TEXT, verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_school_brand_assets_provider ON school_brand_assets(provider,external_school_id)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS school_brand_sync_state (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_url TEXT NOT NULL,
    last_checked_at TEXT, last_successful_sync_at TEXT,
    source_school_count INTEGER NOT NULL DEFAULT 0,
    target_school_count INTEGER NOT NULL DEFAULT 0,
    matched_school_count INTEGER NOT NULL DEFAULT 0,
    unresolved_school_count INTEGER NOT NULL DEFAULT 0,
    ambiguous_school_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function brandingFresh(env, now, maxAgeHours) {
  const row = await env.DB.prepare("SELECT last_successful_sync_at,matched_school_count FROM school_brand_sync_state WHERE id=?").bind(SYNC_ID).first();
  const last = row?.last_successful_sync_at ? Date.parse(row.last_successful_sync_at) : NaN;
  return Number(row?.matched_school_count || 0) >= 100 && Number.isFinite(last) && now.getTime() - last < maxAgeHours * 60 * 60 * 1000;
}

async function batch(env, statements, size = 50) {
  for (let i = 0; i < statements.length; i += size) await env.DB.batch(statements.slice(i, i + size));
}

export async function syncMaxPrepsSchoolBranding(env, {
  sourceUrl = MAXPREPS_ARKANSAS_SCHOOLS,
  fetchFn = fetch,
  now = new Date(),
  force = false,
  maxAgeHours = 168
} = {}) {
  await ensureSchoolBrandingSchema(env);
  if (!force && await brandingFresh(env, now, maxAgeHours)) return { status: "SKIPPED", reason: "branding_fresh" };
  const checkedAt = now.toISOString();
  try {
    const response = await fetchFn(sourceUrl, { headers: { "user-agent": "LocalBleachersAR-branding/1.0", accept: "text/html" } });
    if (!response.ok) throw new Error(`MaxPreps school directory HTTP ${response.status}`);
    const entries = parseMaxPrepsSchoolDirectory(await response.text());
    if (entries.length < 150) throw new Error(`MaxPreps school directory returned only ${entries.length} logo entries`);

    const [{ results: schools }, { results: aliases }] = await Promise.all([
      env.DB.prepare(`SELECT s.id,s.name,s.city,s.state,s.level,s.mascot,s.logo_url,s.location_matched_name
        FROM schools s
        WHERE s.catalog_scope='local'
          AND EXISTS (SELECT 1 FROM teams t WHERE t.school_id=s.id AND t.active=1)
        ORDER BY s.name`).all(),
      env.DB.prepare("SELECT normalized_alias,alias_text,school_id FROM school_aliases").all()
    ]);
    const { matches, unresolved, ambiguous } = matchMaxPrepsBranding(entries, schools, aliases);
    const statements = [];
    for (const match of matches) {
      const entry = match.entry;
      statements.push(env.DB.prepare(`INSERT INTO school_brand_assets
        (school_id,logo_url,provider,external_school_id,source_url,match_method,match_confidence,status,last_checked_at,verified_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'matched',?,?,?)
        ON CONFLICT(school_id) DO UPDATE SET
          logo_url=excluded.logo_url,provider=excluded.provider,external_school_id=excluded.external_school_id,
          source_url=excluded.source_url,match_method=excluded.match_method,match_confidence=excluded.match_confidence,
          status='matched',last_checked_at=excluded.last_checked_at,verified_at=excluded.verified_at,updated_at=excluded.updated_at
        WHERE school_brand_assets.status!='curated'`)
        .bind(match.schoolId, entry.logoUrl, PROVIDER, entry.externalSchoolId, entry.sourceUrl, match.matchMethod, match.confidence, checkedAt, checkedAt, checkedAt));
    }
    for (const school of unresolved) {
      statements.push(env.DB.prepare(`INSERT INTO school_brand_assets(school_id,status,last_checked_at,updated_at)
        VALUES(?,'unresolved',?,?)
        ON CONFLICT(school_id) DO UPDATE SET last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at
        WHERE school_brand_assets.status!='curated' AND school_brand_assets.status!='matched'`)
        .bind(school.id, checkedAt, checkedAt));
    }
    await batch(env, statements);

    await env.DB.prepare(`UPDATE schools SET
      logo_url=COALESCE((SELECT logo_url FROM school_brand_assets b WHERE b.school_id=schools.id AND b.logo_url IS NOT NULL),logo_url),
      mascot=COALESCE(NULLIF((SELECT mascot FROM school_brand_assets b WHERE b.school_id=schools.id),''),mascot),
      updated_at=CASE WHEN EXISTS(SELECT 1 FROM school_brand_assets b WHERE b.school_id=schools.id AND b.logo_url IS NOT NULL) THEN ? ELSE updated_at END
      WHERE catalog_scope='local'`).bind(checkedAt).run();

    const details = {
      sourceEntries: entries.length,
      matched: matches.length,
      unresolved: unresolved.map(school => ({ id: school.id, name: school.location_matched_name || school.name, city: school.city })),
      ambiguous: ambiguous.map(item => ({ name: item.entry.name, city: item.entry.city, schoolIds: item.schoolIds }))
    };
    await env.DB.prepare(`INSERT INTO school_brand_sync_state
      (id,provider,source_url,last_checked_at,last_successful_sync_at,source_school_count,target_school_count,matched_school_count,unresolved_school_count,ambiguous_school_count,last_error,details_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,source_url=excluded.source_url,last_checked_at=excluded.last_checked_at,
        last_successful_sync_at=excluded.last_successful_sync_at,source_school_count=excluded.source_school_count,target_school_count=excluded.target_school_count,
        matched_school_count=excluded.matched_school_count,unresolved_school_count=excluded.unresolved_school_count,ambiguous_school_count=excluded.ambiguous_school_count,
        last_error=NULL,details_json=excluded.details_json,updated_at=excluded.updated_at`)
      .bind(SYNC_ID, PROVIDER, sourceUrl, checkedAt, checkedAt, entries.length, schools.length, matches.length, unresolved.length, ambiguous.length, JSON.stringify(details), checkedAt).run();
    return { status: "SUCCESS", sourceEntries: entries.length, targetSchools: schools.length, matchedSchools: matches.length, unresolvedSchools: unresolved.length, ambiguousEntries: ambiguous.length, details };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    await env.DB.prepare(`INSERT INTO school_brand_sync_state(id,provider,source_url,last_checked_at,last_error,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .bind(SYNC_ID, PROVIDER, sourceUrl, checkedAt, message, checkedAt).run();
    throw error;
  }
}
