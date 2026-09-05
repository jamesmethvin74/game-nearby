import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { matchMaxPrepsBranding } from "../src/school-branding.js";
import { parseMaxPrepsSchoolLinks, parseMaxPrepsSchoolPageLogo } from "../src/maxpreps-school-page-logo.js";
import { AUDIT_MISSING_IDS, encodeMissingMask } from "./statewide-logo-audit-mask.mjs";

const DIRS = [
  "https://www.maxpreps.com/ar/schools/",
  "https://www.maxpreps.com/ar/football/schools/",
  "https://www.maxpreps.com/ar/basketball/schools/",
  "https://www.maxpreps.com/ar/volleyball/schools/",
  "https://www.maxpreps.com/ar/cross-country/schools/",
  "https://www.maxpreps.com/ar/soccer/girls/schools/"
];
const missing68 = Buffer.from("00000000f09db6e82293ed4de71fedc9ebeb02", "hex");
const covered19Base32 = "aaaaaaaarqicqauamaeaefibjaaiaaa";
function decodeBase32(value) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, acc = 0;
  const out = [];
  for (const ch of value) {
    const n = alphabet.indexOf(ch);
    if (n < 0) throw new Error(`bad base32 ${ch}`);
    acc = (acc << 5) | n; bits += 5;
    if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const covered19 = decodeBase32(covered19Base32);
const isSet = (bytes, i) => (((bytes[Math.floor(i/8)] || 0) >> (i%8)) & 1) === 1;
const remainingIds = AUDIT_MISSING_IDS.filter((id, i) => isSet(missing68, i) && !isSet(covered19, i));
if (remainingIds.length !== 49 || remainingIds.some(id => !id.startsWith("aaa-"))) throw new Error(`Expected exact 49 AAA IDs, got ${remainingIds.length}`);

const reconciliation = JSON.parse(fs.readFileSync("data/arkansas-high-school-production-reconciliation.json", "utf8"));
const seed = reconciliation.aaa_certified_schools_not_in_production || [];
const byId = new Map(seed.map(row => [`aaa-${String(row.aaa_id).toLowerCase()}`, row]));
const schools = remainingIds.map(id => {
  const row = byId.get(id);
  if (!row) throw new Error(`Missing reconciliation row ${id}`);
  return { id, name:row.school_name, location_matched_name:null, city:"", state:"AR", level:"high-school" };
});

const directoryResults = await Promise.all(DIRS.map(async sourceUrl => {
  try {
    const response = await fetch(sourceUrl, { headers:{"user-agent":"LocalBleachersAR-final-logo-probe/1.0",accept:"text/html"}, redirect:"follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const links = parseMaxPrepsSchoolLinks(await response.text());
    return { sourceUrl, links, error:null };
  } catch (error) {
    return { sourceUrl, links:[], error:String(error?.message || error) };
  }
}));

const allLinks = [];
const seen = new Set();
for (const row of directoryResults) {
  console.log(`PAGE_LOGO_DIR source=${row.sourceUrl} links=${row.links.length} error=${row.error || "none"}`);
  for (const link of row.links) {
    const key = `${link.name}|${link.city}|${link.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key); allLinks.push(link);
  }
}
const linkMatches = matchMaxPrepsBranding(allLinks, schools, []).matches;
const linkBySchool = new Map();
for (const match of linkMatches) if (!linkBySchool.has(match.schoolId)) linkBySchool.set(match.schoolId, match.entry);
console.log(`PAGE_LOGO_LINK_MATCHES ${linkBySchool.size}/49`);

const pageResults = await Promise.all(remainingIds.map(async id => {
  const school = schools.find(row => row.id === id);
  const entry = linkBySchool.get(id);
  if (!entry) return { id, ok:false, reason:"no-page-link" };
  try {
    const response = await fetch(entry.sourceUrl, { headers:{"user-agent":"LocalBleachersAR-final-logo-probe/1.0",accept:"text/html"}, redirect:"follow" });
    if (!response.ok) return { id, ok:false, reason:`HTTP ${response.status}`, sourceUrl:entry.sourceUrl };
    const result = parseMaxPrepsSchoolPageLogo(await response.text(), { name:school.name, sourceName:entry.name, sourceUrl:entry.sourceUrl });
    if (!result?.logoUrl) return { id, ok:false, reason:"no-school-logo", sourceUrl:entry.sourceUrl };
    return { id, ok:true, sourceUrl:entry.sourceUrl, ...result };
  } catch (error) {
    return { id, ok:false, reason:String(error?.message || error), sourceUrl:entry.sourceUrl };
  }
}));

const covered = pageResults.filter(row => row.ok).map(row => row.id);
for (const row of pageResults) console.log(`PAGE_LOGO_RESULT id=${row.id} ok=${row.ok} reason=${row.reason || row.method || "ok"}`);
const { count, encoded } = encodeMissingMask(JSON.stringify(covered));
if (count !== covered.length) throw new Error(`coverage mask mismatch ${count} != ${covered.length}`);
console.log(`PAGE_LOGO_TOTAL covered=${covered.length} unresolved=${49-covered.length}`);
const alias = `p-${encoded}`;
execFileSync("wrangler", ["versions","upload","src/logo-bootstrap-worker.js","--preview-alias",alias,"--keep-vars"], { stdio:"inherit" });
