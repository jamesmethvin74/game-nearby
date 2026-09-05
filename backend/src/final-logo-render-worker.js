import app from "./logo-bootstrap-worker.js";
import {
  buildHighSchoolLogoCandidates,
  MAXPREPS_ARKANSAS_ALL_SCHOOLS,
  MAXPREPS_ARKANSAS_FOOTBALL_SCHOOLS,
  MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS,
  MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS
} from "./statewide-logo-completion.js";
import { parseMaxPrepsSchoolDirectory } from "./school-branding.js";
import { collegeBrandingSourceUrls, parseOfficialCollegeLogo } from "./college-logo-bootstrap.js";
import { isSchoolCatalogVisible } from "./high-school-catalog-identity.js";

export const FINAL_LOGO_READY_PATH = "/api/v1/content/final-logo-render/ready";
export const FINAL_LOGO_HIGH_SCHOOL_PATH = "/api/v1/content/final-logo-render/high-school";
export const FINAL_LOGO_COLLEGE_PATH = "/api/v1/content/final-logo-render/college";
export const FINAL_HIGH_SCHOOL_LIMIT = 25;
export const FINAL_COLLEGE_LIMIT = 8;

const SOURCE_FETCH_TIMEOUT_MS = 10000;
const IMAGE_FETCH_TIMEOUT_MS = 8000;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

function authorized(request, env) {
  return Boolean(env.FINAL_LOGO_TOKEN)
    && request.headers.get("x-final-logo-token") === env.FINAL_LOGO_TOKEN;
}

async function inputJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function requestedIds(input, limit) {
  const values = Array.isArray(input?.schoolIds) ? input.schoolIds : [];
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, limit);
}

async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = SOURCE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal:controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isHttps(value) {
  try {
    return new URL(clean(value)).protocol === "https:";
  } catch {
    return false;
  }
}

export async function probeFinalLogoImage(value, fetchFn = fetch) {
  const raw = clean(value);
  if (!isHttps(raw)) throw new Error("logo URL is not HTTPS");
  let lastError = "image fetch failed";
  for (const useRange of [true, false]) {
    try {
      const headers = {
        accept:"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent":"Mozilla/5.0 LocalBleachersAR final logo repair"
      };
      if (useRange) headers.range = "bytes=0-4095";
      const response = await fetchWithTimeout(fetchFn, raw, {
        method:"GET",
        headers,
        redirect:"follow"
      }, IMAGE_FETCH_TIMEOUT_MS);
      const contentType = clean(response.headers?.get?.("content-type")).toLowerCase();
      if (response.ok && contentType.startsWith("image/")) {
        const finalUrl = clean(response.url) || raw;
        if (!isHttps(finalUrl)) throw new Error("logo redirected away from HTTPS");
        return { url:finalUrl, status:response.status, contentType };
      }
      lastError = response.ok
        ? `logo content-type ${contentType || "missing"}`
        : `logo HTTP ${response.status}`;
      if (![403,405,416].includes(response.status)) break;
    } catch (error) {
      lastError = String(error?.name || error?.message || error);
    }
  }
  throw new Error(lastError);
}

async function fetchDirectory(sourceUrl, fetchFn) {
  const response = await fetchWithTimeout(fetchFn, sourceUrl, {
    headers: { "user-agent":"LocalBleachersAR-final-logo/1.0", accept:"text/html" },
    redirect:"follow"
  });
  if (!response.ok) throw new Error(`${sourceUrl} HTTP ${response.status}`);
  return parseMaxPrepsSchoolDirectory(await response.text());
}

async function writeBrandRows(env, rows, checkedAt) {
  if (!rows.length) return { rowsRead:0, rowsWritten:0 };
  const payload = JSON.stringify(rows);
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
  return {
    rowsRead:meta.reduce((sum,row) => sum + Number(row.rows_read || 0),0),
    rowsWritten:meta.reduce((sum,row) => sum + Number(row.rows_written || 0),0)
  };
}

export async function repairHighSchoolLogoIds(env, schoolIds, { fetchFn = fetch, now = new Date() } = {}) {
  const ids = [...new Set((schoolIds || []).map(clean).filter(Boolean))].slice(0, FINAL_HIGH_SCHOOL_LIMIT);
  if (!ids.length) return { status:"COMPLETE", attempted:0, written:0, failures:[] };
  const checkedAt = now.toISOString();
  const idsJson = JSON.stringify(ids);
  const [{ results: rawSchools = [] }, { results: aliases = [] }] = await Promise.all([
    env.DB.prepare(`
      SELECT s.id,s.name,s.location_matched_name,s.city,s.state,s.level,s.mascot
      FROM schools s
      WHERE s.catalog_scope='local' AND s.level='high-school'
        AND s.id IN (SELECT value FROM json_each(?))
        AND EXISTS(SELECT 1 FROM teams t WHERE t.school_id=s.id AND t.active=1)
      ORDER BY s.id
    `).bind(idsJson).all(),
    env.DB.prepare("SELECT normalized_alias,alias_text,school_id FROM school_aliases").all()
  ]);
  const schools = rawSchools.filter(isSchoolCatalogVisible);
  const sourceUrls = [
    MAXPREPS_ARKANSAS_ALL_SCHOOLS,
    MAXPREPS_ARKANSAS_FOOTBALL_SCHOOLS,
    MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS,
    MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS
  ];
  const sourceResults = await Promise.allSettled(sourceUrls.map(url => fetchDirectory(url, fetchFn)));
  const entriesAt = index => sourceResults[index].status === "fulfilled" ? sourceResults[index].value : [];
  const sourceFailures = sourceResults.map((result,index) => result.status === "rejected"
    ? { sourceUrl:sourceUrls[index], error:String(result.reason?.message || result.reason) }
    : null).filter(Boolean);
  const candidates = buildHighSchoolLogoCandidates({
    schools,
    aliases,
    allSchoolEntries:entriesAt(0),
    footballEntries:entriesAt(1),
    basketballEntries:entriesAt(2),
    volleyballEntries:entriesAt(3)
  });
  const bySchool = new Map(candidates.map(row => [row.schoolId, row]));
  const outcomes = await Promise.all(schools.map(async school => {
    const candidate = bySchool.get(school.id);
    if (!candidate?.logoUrl) return { schoolId:school.id, failure:"no-authoritative-logo-candidate" };
    try {
      const probe = await probeFinalLogoImage(candidate.logoUrl, fetchFn);
      return { ...candidate, logoUrl:probe.url };
    } catch (error) {
      return { schoolId:school.id, failure:String(error?.message || error) };
    }
  }));
  const rows = outcomes.filter(row => !row.failure);
  const failures = outcomes.filter(row => row.failure).map(row => ({ schoolId:row.schoolId, error:row.failure }));
  for (const id of ids) {
    if (!schools.some(row => row.id === id)) failures.push({ schoolId:id, error:"not-supported-visible-high-school" });
  }
  const meta = await writeBrandRows(env, rows, checkedAt);
  return {
    status:failures.length ? "PARTIAL" : "SUCCESS",
    attempted:ids.length,
    written:rows.length,
    failures,
    sourceFailures,
    ...meta
  };
}

async function discoverCollegeLogo(school, fetchFn) {
  const failures = [];
  for (const sourceUrl of collegeBrandingSourceUrls(school.id)) {
    try {
      const response = await fetchWithTimeout(fetchFn, sourceUrl, {
        headers:{ "user-agent":"LocalBleachersAR-final-college-logo/1.0", accept:"text/html" },
        redirect:"follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const finalSourceUrl = clean(response.url) || sourceUrl;
      const candidate = parseOfficialCollegeLogo(await response.text(), finalSourceUrl);
      if (!candidate) throw new Error("no logo candidate");
      const probe = await probeFinalLogoImage(candidate.url, fetchFn);
      return {
        schoolId:school.id,
        mascot:school.mascot || null,
        logoUrl:probe.url,
        provider:"official-college",
        providerName:school.name,
        sourceUrl:finalSourceUrl,
        matchMethod:`${candidate.method}+render-probe`,
        matchConfidence:Math.min(1, Math.max(0.6, Number(candidate.score || 60) / 100)),
        status:"curated"
      };
    } catch (error) {
      failures.push({ sourceUrl, error:String(error?.name || error?.message || error) });
    }
  }
  return { schoolId:school.id, failure:failures.length ? failures : [{ sourceUrl:null, error:"no branding source configured" }] };
}

export async function repairCollegeLogoIds(env, schoolIds, { fetchFn = fetch, now = new Date() } = {}) {
  const ids = [...new Set((schoolIds || []).map(clean).filter(Boolean))]
    .filter(id => id !== "asu-three-rivers")
    .slice(0, FINAL_COLLEGE_LIMIT);
  if (!ids.length) return { status:"COMPLETE", attempted:0, written:0, failures:[] };
  const checkedAt = now.toISOString();
  const { results: schools = [] } = await env.DB.prepare(`
    SELECT id,name,city,state,level,mascot
    FROM schools
    WHERE catalog_scope='local' AND level='college'
      AND id <> 'asu-three-rivers'
      AND id IN (SELECT value FROM json_each(?))
    ORDER BY id
  `).bind(JSON.stringify(ids)).all();
  const outcomes = await Promise.all(schools.map(row => discoverCollegeLogo(row, fetchFn)));
  const rows = outcomes.filter(row => !row.failure);
  const failures = outcomes.filter(row => row.failure).map(row => ({ schoolId:row.schoolId, attempts:row.failure }));
  for (const id of ids) {
    if (!schools.some(row => row.id === id)) failures.push({ schoolId:id, attempts:[{ sourceUrl:null, error:"not-supported-college" }] });
  }
  const meta = await writeBrandRows(env, rows, checkedAt);
  return {
    status:failures.length ? "PARTIAL" : "SUCCESS",
    attempted:ids.length,
    written:rows.length,
    failures,
    ...meta
  };
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method === "HEAD" && path === FINAL_LOGO_READY_PATH) {
      return authorized(request, env)
        ? new Response(null, { status:204, headers:{ "cache-control":"no-store" } })
        : privateJson({ error:"not_found" }, 404);
    }
    if (request.method === "POST" && (path === FINAL_LOGO_HIGH_SCHOOL_PATH || path === FINAL_LOGO_COLLEGE_PATH)) {
      if (!authorized(request, env)) return privateJson({ error:"not_found" }, 404);
      const input = await inputJson(request);
      try {
        const result = path === FINAL_LOGO_HIGH_SCHOOL_PATH
          ? await repairHighSchoolLogoIds(env, requestedIds(input, FINAL_HIGH_SCHOOL_LIMIT))
          : await repairCollegeLogoIds(env, requestedIds(input, FINAL_COLLEGE_LIMIT));
        return privateJson(result);
      } catch (error) {
        console.error("final logo render repair failed", { path, error:String(error?.message || error) });
        return privateJson({ status:"FAILURE", error:String(error?.message || error) }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
