import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parseMaxPrepsSchoolDirectory, matchMaxPrepsBranding } from "../src/school-branding.js";
import { AUDIT_MISSING_IDS, encodeMissingMask } from "./statewide-logo-audit-mask.mjs";

const SOURCES = [
  "https://www.maxpreps.com/ar/schools/",
  "https://www.maxpreps.com/ar/football/schools/",
  "https://www.maxpreps.com/ar/basketball/schools/",
  "https://www.maxpreps.com/ar/volleyball/schools/"
];
const missingMask = Buffer.from("00000000f09db6e82293ed4de71fedc9ebeb02", "hex");
const missingIds = AUDIT_MISSING_IDS.filter((_, index) => ((missingMask[Math.floor(index / 8)] || 0) >> (index % 8)) & 1);
if (missingIds.length !== 68 || missingIds.some(id => !id.startsWith("aaa-"))) throw new Error("Expected exact 68-school high-school saved-result set");

const reconciliation = JSON.parse(fs.readFileSync("data/arkansas-high-school-production-reconciliation.json", "utf8"));
const seed = Array.isArray(reconciliation?.aaa_certified_schools_not_in_production)
  ? reconciliation.aaa_certified_schools_not_in_production
  : [];
const byId = new Map(seed.map(row => [`aaa-${String(row.aaa_id).toLowerCase()}`, row]));
const schools = missingIds.map(id => {
  const row = byId.get(id);
  if (!row) throw new Error(`AAA reconciliation row missing for ${id}`);
  return { id, name:row.school_name, location_matched_name:null, city:"", state:"AR", level:"high-school" };
});

const sourceResults = await Promise.all(SOURCES.map(async sourceUrl => {
  try {
    const response = await fetch(sourceUrl, {
      headers:{ "user-agent":"LocalBleachersAR-logo-coverage/1.0", accept:"text/html" },
      redirect:"follow"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const entries = parseMaxPrepsSchoolDirectory(await response.text());
    const matched = matchMaxPrepsBranding(entries, schools, []).matches.map(row => row.schoolId);
    return { sourceUrl, entries:entries.length, matched, error:null };
  } catch (error) {
    return { sourceUrl, entries:0, matched:[], error:String(error?.message || error) };
  }
}));

const covered = new Set(sourceResults.flatMap(row => row.matched));
const failures = sourceResults.filter(row => row.error);
for (const row of sourceResults) console.log(`LOGO_SOURCE_COVERAGE source=${row.sourceUrl} entries=${row.entries} matched=${row.matched.length} error=${row.error || "none"}`);
const { count, encoded } = encodeMissingMask(JSON.stringify([...covered]));
if (count !== covered.size) throw new Error(`Mask count mismatch ${count} != ${covered.size}`);
console.log(`LOGO_SOURCE_COVERAGE_TOTAL missing=68 covered=${covered.size} unresolved=${68-covered.size} failures=${failures.length}`);
console.log(`LOGO_SOURCE_COVERAGE_UNRESOLVED ${missingIds.filter(id => !covered.has(id)).join(",")}`);
const alias = `c-${encoded}`;
execFileSync("wrangler", ["versions", "upload", "src/logo-bootstrap-worker.js", "--preview-alias", alias, "--keep-vars"], { stdio:"inherit" });
