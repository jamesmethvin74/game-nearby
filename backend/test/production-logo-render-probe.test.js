import test from "node:test";
import assert from "node:assert/strict";

const API = "https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/schools";
const UNSUPPORTED = "asu-three-rivers";
const EXPECTED_COLLEGE_IDS = [
  "uark","arkansas-state","uapb","uca","little-rock","arkansas-tech","uafs","uam","harding","henderson-state","ouachita-baptist","southern-arkansas","hendrix","lyon","ozarks","arkansas-baptist","cbc","crowleys-ridge","john-brown","philander-smith","williams-baptist","asu-mid-south","asu-mountain-home","asu-newport","national-park","north-arkansas","nwacc","shorter","south-arkansas","seark","sau-tech","ua-rich-mountain","ua-cossatot","champion-christian","ecclesia"
];

function clean(value) { return String(value ?? "").trim(); }
function httpsUrl(value) {
  try { const url = new URL(clean(value)); return url.protocol === "https:" ? url.toString() : ""; }
  catch { return ""; }
}
function sourceClass(url) {
  const value = clean(url).toLowerCase();
  if (/maxpreps/.test(value)) return "maxpreps";
  if (/scorestream/.test(value)) return "scorestream";
  if (/sblive|scorebooklive/.test(value)) return "sblive";
  if (/mascot/.test(value)) return "mascot";
  if (/sidearm|prestosports/.test(value)) return "college-platform";
  if (/\.edu\//.test(value) || /athletics|sports/.test(value)) return "official-or-athletics";
  return "unknown";
}
async function probe(url) {
  const raw = httpsUrl(url);
  if (!raw) return { ok:false, status:null, type:null, reason:"blank-or-non-https" };
  for (const useRange of [true, false]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const headers = { accept:"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "user-agent":"Mozilla/5.0 LocalBleachersAR production render probe" };
      if (useRange) headers.range = "bytes=0-4095";
      const response = await fetch(raw, { method:"GET", redirect:"follow", headers, signal:controller.signal });
      const type = clean(response.headers.get("content-type")).toLowerCase();
      const result = { ok:response.ok && type.startsWith("image/"), status:response.status, type:type || null, finalUrl:clean(response.url) || raw, reason:response.ok ? (type.startsWith("image/") ? null : `non-image:${type || "missing"}`) : `http-${response.status}` };
      if (result.ok || ![403,405,416].includes(response.status)) return result;
    } catch (error) {
      if (!useRange) return { ok:false, status:null, type:null, finalUrl:raw, reason:`fetch-${error?.name || "error"}` };
    } finally { clearTimeout(timer); }
  }
  return { ok:false, status:null, type:null, finalUrl:raw, reason:"probe-failed" };
}

test("read-only production school logo render probe", { timeout:120000 }, async () => {
  const response = await fetch(API, { headers:{ accept:"application/json", "cache-control":"no-store" } });
  assert.equal(response.ok, true, `production schools API HTTP ${response.status}`);
  const payload = await response.json();
  const schools = Array.isArray(payload?.schools) ? payload.schools : [];
  const colleges = schools.filter(row => clean(row.level) === "college");
  const highSchools = schools.filter(row => clean(row.level) === "high-school");
  const threeRivers = schools.find(row => clean(row.id) === UNSUPPORTED);
  const collegeIds = new Set(colleges.map(row => clean(row.id)));
  const missingColleges = EXPECTED_COLLEGE_IDS.filter(id => !collegeIds.has(id));

  console.log(`PROD_LOGO_CATALOG total=${schools.length} colleges=${colleges.length} highSchools=${highSchools.length} threeRivers=${Boolean(threeRivers)}`);
  console.log(`PROD_LOGO_MISSING_COLLEGES count=${missingColleges.length} ids=${missingColleges.join(",") || "none"}`);

  let cursor = 0;
  const results = new Array(schools.length);
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= schools.length) return;
      const school = schools[i];
      const url = clean(school.logo_url);
      results[i] = { id:clean(school.id), name:clean(school.name), level:clean(school.level), url, source:sourceClass(url), ...(await probe(url)) };
    }
  }
  await Promise.all(Array.from({ length:20 }, () => worker()));

  const supported = results.filter(row => row.id !== UNSUPPORTED && (row.level === "college" || row.level === "high-school"));
  const failures = supported.filter(row => !row.ok);
  const unknown = supported.filter(row => row.ok && row.source === "unknown");
  console.log(`PROD_LOGO_SUMMARY supported=${supported.length} college=${colleges.length} highSchool=${highSchools.length} renderable=${supported.length-failures.length} failures=${failures.length} unknownSource=${unknown.length}`);
  for (const row of failures) console.log(`PROD_LOGO_FAIL level=${row.level} id=${row.id} name=${JSON.stringify(row.name)} status=${row.status ?? "none"} type=${row.type ?? "none"} reason=${row.reason ?? "none"} url=${row.url || "NULL"}`);
  for (const row of unknown) console.log(`PROD_LOGO_UNKNOWN level=${row.level} id=${row.id} name=${JSON.stringify(row.name)} url=${row.url}`);

  assert.equal(Boolean(threeRivers), false, "ASU Three Rivers must not be exposed by production API");
  assert.equal(highSchools.length, 300, `expected 300 supported high schools, got ${highSchools.length}`);
  assert.equal(missingColleges.length, 0, `missing supported colleges: ${missingColleges.join(",")}`);
});
