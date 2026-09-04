import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { CURATED_SCHOOL_BRANDING_IDENTITIES } from "./school-branding-curated.js";
import { isSchoolCatalogVisible } from "./high-school-catalog-identity.js";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cityKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function findSchool(schools, identity) {
  if (identity.targetSchoolId) {
    return schools.find(school => school.id === identity.targetSchoolId) || null;
  }
  const keys = new Set(identity.targetNames.map(normalizeSchoolAlias).filter(Boolean));
  let matches = schools.filter(school => {
    const schoolKeys = [school.name, school.location_matched_name].map(normalizeSchoolAlias).filter(Boolean);
    return schoolKeys.some(key => keys.has(key));
  });
  if (identity.targetCity) {
    const byCity = matches.filter(school => cityKey(school.city) === cityKey(identity.targetCity));
    if (byCity.length) matches = byCity;
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolvedIdentity(identity) {
  if (!identity.logoUrl) throw new Error(`${identity.sourceName} curated identity has no explicit logo URL`);
  return {
    logoUrl: identity.logoUrl,
    mascot: identity.mascot || null,
    canonicalUrl: identity.sourceUrl
  };
}

export async function syncCuratedSchoolBranding(env, { now = new Date(), force = false } = {}) {
  const checkedAt = now.toISOString();
  const { results: schools } = await env.DB.prepare(`SELECT s.id,s.name,s.city,s.state,s.level,s.location_matched_name
    FROM schools s
    WHERE s.catalog_scope='local'
      AND EXISTS (SELECT 1 FROM teams t WHERE t.school_id=s.id AND t.active=1)
    ORDER BY s.name`).all();
  const visibleSchools = schools.filter(isSchoolCatalogVisible);

  let matched = 0;
  let populated = 0;
  const unresolved = [];
  const failures = [];

  for (const identity of CURATED_SCHOOL_BRANDING_IDENTITIES) {
    const school = findSchool(visibleSchools, identity);
    if (!school) {
      unresolved.push({ targetSchoolId: identity.targetSchoolId || null, targetNames: identity.targetNames, targetCity: identity.targetCity || null });
      continue;
    }
    matched++;
    const existing = await env.DB.prepare("SELECT status,logo_url,mascot FROM school_brand_assets WHERE school_id=?").bind(school.id).first();
    const mascotSatisfied = identity.mascot == null || Boolean(existing?.mascot);
    if (!force && existing?.status === "curated" && existing?.logo_url && mascotSatisfied) {
      populated++;
      continue;
    }
    try {
      const resolved = resolvedIdentity(identity);
      const logoUrl = resolved.logoUrl;
      const mascot = resolved.mascot;
      await env.DB.prepare(`INSERT INTO school_brand_assets
        (school_id,mascot,logo_url,provider,provider_name,source_url,mascot_source_url,match_method,match_confidence,status,last_checked_at,mascot_checked_at,verified_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'curated',?,?,?,?)
        ON CONFLICT(school_id) DO UPDATE SET
          mascot=COALESCE(excluded.mascot,school_brand_assets.mascot),logo_url=excluded.logo_url,
          provider=excluded.provider,provider_name=excluded.provider_name,source_url=excluded.source_url,mascot_source_url=excluded.mascot_source_url,
          match_method=excluded.match_method,match_confidence=excluded.match_confidence,status='curated',last_checked_at=excluded.last_checked_at,
          mascot_checked_at=excluded.mascot_checked_at,verified_at=excluded.verified_at,updated_at=excluded.updated_at`)
        .bind(school.id, mascot, logoUrl, identity.sourceType || "maxpreps", identity.sourceName, identity.sourceUrl,
          resolved.canonicalUrl, "curated-identity", 1, checkedAt, checkedAt, checkedAt, checkedAt).run();
      await env.DB.prepare(`UPDATE schools SET mascot=COALESCE(?,mascot),logo_url=?,updated_at=? WHERE id=?`)
        .bind(mascot, logoUrl, checkedAt, school.id).run();
      populated++;
    } catch (error) {
      failures.push({ schoolId: school.id, name: school.location_matched_name || school.name, reason: String(error?.message || error), sourceUrl: identity.sourceUrl });
    }
  }

  return { status: failures.length ? "PARTIAL" : "SUCCESS", identities: CURATED_SCHOOL_BRANDING_IDENTITIES.length, matched, populated, unresolved, failures };
}
