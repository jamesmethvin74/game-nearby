import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { parseMaxPrepsSchoolDirectory, matchMaxPrepsBranding } from "./school-branding.js";
import { CURATED_SCHOOL_BRANDING_IDENTITIES } from "./school-branding-curated.js";
import { isSchoolCatalogVisible } from "./high-school-catalog-identity.js";

export const MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS = "https://www.maxpreps.com/ar/basketball/schools/";
export const MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS = "https://www.maxpreps.com/ar/volleyball/schools/";
export const HIGH_SCHOOL_LOGO_BATCH_LIMIT = 25;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cityKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function curatedIdentityForSchool(school) {
  for (const identity of CURATED_SCHOOL_BRANDING_IDENTITIES) {
    if (identity.targetSchoolId && identity.targetSchoolId === school.id) return identity;
    const keys = new Set(identity.targetNames.map(normalizeSchoolAlias).filter(Boolean));
    const schoolKeys = [school.name, school.location_matched_name].map(normalizeSchoolAlias).filter(Boolean);
    if (!schoolKeys.some(key => keys.has(key))) continue;
    if (identity.targetCity && cityKey(identity.targetCity) !== cityKey(school.city)) continue;
    return identity;
  }
  return null;
}

async function fetchDirectory(sourceUrl, fetchFn) {
  const response = await fetchFn(sourceUrl, {
    headers: { "user-agent": "LocalBleachersAR-logo-completion/1.0", accept: "text/html" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`${sourceUrl} HTTP ${response.status}`);
  return parseMaxPrepsSchoolDirectory(await response.text());
}

export function buildHighSchoolLogoCandidates({ schools, aliases = [], basketballEntries = [], volleyballEntries = [] }) {
  const visible = schools.filter(isSchoolCatalogVisible);
  const bySchool = new Map();

  for (const entries of [basketballEntries, volleyballEntries]) {
    if (!entries.length) continue;
    const result = matchMaxPrepsBranding(entries, visible, aliases);
    for (const match of result.matches) {
      if (bySchool.has(match.schoolId)) continue;
      bySchool.set(match.schoolId, {
        schoolId: match.schoolId,
        mascot: null,
        logoUrl: match.entry.logoUrl,
        provider: "maxpreps",
        providerName: match.entry.name,
        sourceUrl: match.entry.sourceUrl,
        matchMethod: match.matchMethod,
        matchConfidence: match.confidence,
        status: "matched"
      });
    }
  }

  for (const school of visible) {
    const identity = curatedIdentityForSchool(school);
    if (!identity?.logoUrl) continue;
    bySchool.set(school.id, {
      schoolId: school.id,
      mascot: identity.mascot || null,
      logoUrl: identity.logoUrl,
      provider: identity.sourceType || "maxpreps",
      providerName: identity.sourceName,
      sourceUrl: identity.sourceUrl,
      matchMethod: "curated-identity",
      matchConfidence: 1,
      status: "curated"
    });
  }

  return [...bySchool.values()].sort((a, b) => a.schoolId.localeCompare(b.schoolId));
}

export async function runStatewideHighSchoolLogoCompletion(env, {
  fetchFn = fetch,
  now = new Date(),
  limit = HIGH_SCHOOL_LOGO_BATCH_LIMIT
} = {}) {
  const checkedAt = now.toISOString();
  const safeLimit = Math.max(1, Math.min(HIGH_SCHOOL_LOGO_BATCH_LIMIT, Number(limit) || HIGH_SCHOOL_LOGO_BATCH_LIMIT));
  const [{ results: rawSchools }, { results: aliases }] = await Promise.all([
    env.DB.prepare(`
      SELECT s.id,s.name,s.location_matched_name,s.city,s.state,s.level,s.mascot
      FROM schools s
      LEFT JOIN school_brand_assets b ON b.school_id=s.id
      WHERE s.catalog_scope='local' AND s.level='high-school'
        AND EXISTS(SELECT 1 FROM teams t WHERE t.school_id=s.id AND t.active=1)
        AND COALESCE(NULLIF(b.logo_url,''),NULLIF(s.logo_url,'')) IS NULL
      ORDER BY COALESCE(NULLIF(s.location_matched_name,''),s.name),s.id
    `).all(),
    env.DB.prepare("SELECT normalized_alias,alias_text,school_id FROM school_aliases").all()
  ]);
  const missingSchools = rawSchools.filter(isSchoolCatalogVisible);
  if (!missingSchools.length) return { status:"COMPLETE", missingBefore:0, candidates:0, written:0, unresolved:[] };

  const directoryResults = await Promise.allSettled([
    fetchDirectory(MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS, fetchFn),
    fetchDirectory(MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS, fetchFn)
  ]);
  const basketballEntries = directoryResults[0].status === "fulfilled" ? directoryResults[0].value : [];
  const volleyballEntries = directoryResults[1].status === "fulfilled" ? directoryResults[1].value : [];
  const sourceFailures = directoryResults
    .map((result, index) => result.status === "rejected" ? {
      sourceUrl: index === 0 ? MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS : MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS,
      error: String(result.reason?.message || result.reason)
    } : null)
    .filter(Boolean);

  const candidates = buildHighSchoolLogoCandidates({
    schools: missingSchools,
    aliases,
    basketballEntries,
    volleyballEntries
  });
  const batch = candidates.slice(0, safeLimit);
  if (!batch.length) {
    return {
      status:"PARTIAL",
      missingBefore:missingSchools.length,
      candidates:0,
      written:0,
      sourceFailures,
      unresolved:missingSchools.map(row => ({ id:row.id, name:row.location_matched_name || row.name, city:row.city }))
    };
  }

  const payload = JSON.stringify(batch);
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO school_brand_assets
        (school_id,mascot,logo_url,provider,provider_name,source_url,match_method,match_confidence,status,last_checked_at,verified_at,updated_at)
      SELECT
        json_extract(value,'$.schoolId'),json_extract(value,'$.mascot'),json_extract(value,'$.logoUrl'),
        json_extract(value,'$.provider'),json_extract(value,'$.providerName'),json_extract(value,'$.sourceUrl'),
        json_extract(value,'$.matchMethod'),CAST(json_extract(value,'$.matchConfidence') AS REAL),
        json_extract(value,'$.status'),?,?,?
      FROM json_each(?) WHERE 1
      ON CONFLICT(school_id) DO UPDATE SET
        mascot=COALESCE(excluded.mascot,school_brand_assets.mascot),
        logo_url=excluded.logo_url,provider=excluded.provider,provider_name=excluded.provider_name,
        source_url=excluded.source_url,match_method=excluded.match_method,match_confidence=excluded.match_confidence,
        status=CASE WHEN school_brand_assets.status='curated' THEN 'curated' ELSE excluded.status END,
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
  const writtenIds = new Set(batch.map(row => row.schoolId));
  const unresolved = missingSchools
    .filter(row => !writtenIds.has(row.id) && !candidates.some(candidate => candidate.schoolId === row.id))
    .map(row => ({ id:row.id, name:row.location_matched_name || row.name, city:row.city }));

  return {
    status: missingSchools.length <= batch.length ? "COMPLETE" : "PARTIAL",
    missingBefore: missingSchools.length,
    candidates: candidates.length,
    written: batch.length,
    remainingKnownCandidates: Math.max(0, candidates.length - batch.length),
    sourceEntries: { basketball:basketballEntries.length, volleyball:volleyballEntries.length },
    sourceFailures,
    unresolved,
    rowsRead: meta.reduce((sum, row) => sum + Number(row.rows_read || 0), 0),
    rowsWritten: meta.reduce((sum, row) => sum + Number(row.rows_written || 0), 0)
  };
}
