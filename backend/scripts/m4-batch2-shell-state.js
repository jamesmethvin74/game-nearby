import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2];
const stateSql = `SELECT
  COUNT(DISTINCT CASE WHEN g.id IS NOT NULL THEN src.id END) AS populated_sources,
  COUNT(g.id) AS game_rows,
  COUNT(DISTINCT CASE WHEN g.id IS NULL THEN src.id END) AS eligible_sources
FROM sources src
JOIN teams t ON t.id=src.team_id AND t.active=1
JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local'
LEFT JOIN games g ON g.source_id=src.id AND g.team_id=t.id
WHERE src.enabled=1
  AND sch.level='college'
  AND t.season='2026'`;

function readState() {
  const raw = execFileSync("wrangler", [
    "d1", "execute", "localbleachersar-sports", "--remote",
    `--command=${stateSql}`, "--json"
  ], { encoding:"utf8", stdio:["ignore","pipe","inherit"] });
  const parsed = JSON.parse(raw);
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const row = envelopes.flatMap(item => item?.results || []).find(Boolean);
  if (!row) throw new Error("M4 Batch 2 state query returned no row");
  return {
    populatedSources:Number(row.populated_sources || 0),
    gameRows:Number(row.game_rows || 0),
    eligibleSources:Number(row.eligible_sources || 0)
  };
}

if (mode === "pre") {
  const before = readState();
  writeFileSync("/tmp/m4-batch2-before.json", JSON.stringify(before));
  console.log(JSON.stringify({ status:"M4_BATCH2_PRE", before }));
  process.exit(0);
}

if (mode !== "verify") throw new Error("Usage: node m4-batch2-shell-state.js pre|verify");

const before = JSON.parse(readFileSync("/tmp/m4-batch2-before.json", "utf8"));
const payload = JSON.parse(readFileSync("/tmp/m4-batch2-response.json", "utf8"));
const selected = Number(payload.selectedSources ?? payload.sources ?? 0);
const attempted = Number(payload.attemptedSources ?? payload.sources ?? 0);
const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];

if (payload.status !== "SUCCESS" && payload.status !== "SKIPPED") {
  throw new Error(`Unexpected Batch 2 response: ${JSON.stringify(payload)}`);
}
if (selected < 0 || selected > 8 || attempted < 0 || attempted > 8) {
  throw new Error(`Batch 2 exceeded max-8 bound: ${JSON.stringify({selected,attempted})}`);
}
if (payload.status === "SUCCESS" && selected < 1) {
  throw new Error(`Batch 2 SUCCESS selected zero sources: ${JSON.stringify(payload)}`);
}
if (payload.status === "SKIPPED" && (selected !== 0 || attempted !== 0)) {
  throw new Error(`Batch 2 SKIPPED with work: ${JSON.stringify({selected,attempted})}`);
}
if (payload.status === "SKIPPED" && Number(before.eligibleSources || 0) > 0) {
  throw new Error(`Batch 2 unexpectedly skipped despite eligible sources: ${JSON.stringify({before,payload})}`);
}

const hardFailureText = JSON.stringify(outcomes).toLowerCase();
const hardStatus = outcomes.some(outcome => {
  if (outcome?.status === "ERROR") return true;
  const status = Number(outcome?.status);
  return Number.isFinite(status) && (status === 429 || status >= 500);
});
if (hardStatus || hardFailureText.includes("d1_error") || hardFailureText.includes("row read limit") || hardFailureText.includes("row write limit") || hardFailureText.includes("exceeded d1")) {
  throw new Error(`Batch 2 encountered a resource/server failure: ${JSON.stringify(outcomes)}`);
}

const after = readState();
if (payload.status === "SUCCESS") {
  if (after.populatedSources <= before.populatedSources) {
    throw new Error(`Batch 2 produced no newly populated source: ${JSON.stringify({before,after,payload})}`);
  }
  if (after.eligibleSources >= before.eligibleSources) {
    throw new Error(`Batch 2 did not reduce zero-game eligible sources: ${JSON.stringify({before,after,payload})}`);
  }
}
if (after.gameRows < before.gameRows) {
  throw new Error(`Batch 2 game rows regressed: ${JSON.stringify({before,after})}`);
}

console.log(JSON.stringify({
  status:"M4_BOOTSTRAP_BATCH2_VERIFIED",
  selectedSources:selected,
  attemptedSources:attempted,
  providerGroups:Number(payload.providerGroups || 0),
  selectorRowsRead:Number(payload.selectorRowsRead || 0),
  before,
  after,
  newPopulatedSources:after.populatedSources-before.populatedSources,
  newGameRows:after.gameRows-before.gameRows,
  eligibleSourcesReduced:before.eligibleSources-after.eligibleSources
}));
