import { execFileSync } from "node:child_process";

const triggerUrl = "https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/m4/bootstrap-approved-FIJy3Ofb8ZW9ZezIvbcPEYS3YJfuwBKLFpJ7lQYsnFc";
const stateSql = `SELECT COUNT(DISTINCT g.source_id) AS populated_sources, COUNT(*) AS game_rows
FROM games g
JOIN sources src ON src.id=g.source_id
JOIN teams t ON t.id=g.team_id
JOIN schools sch ON sch.id=t.school_id
WHERE sch.level='college' AND sch.catalog_scope='local' AND t.season='2026'`;

function readState() {
  const raw = execFileSync("wrangler", [
    "d1", "execute", "localbleachersar-sports", "--remote",
    `--command=${stateSql}`, "--json"
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const parsed = JSON.parse(raw);
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const row = envelopes.flatMap(item => item?.results || []).find(Boolean);
  if (!row) throw new Error("M4 bootstrap state query returned no row");
  return {
    populatedSources: Number(row.populated_sources || 0),
    gameRows: Number(row.game_rows || 0)
  };
}

const before = readState();
execFileSync("wrangler", ["deploy"], { stdio: "inherit" });

const response = await fetch(triggerUrl, {
  method: "GET",
  headers: { accept: "application/json", "cache-control": "no-store" },
  redirect: "error"
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`M4 bootstrap trigger HTTP ${response.status}: ${JSON.stringify(payload)}`);

const selected = Number(payload.selectedSources ?? payload.sources ?? 0);
const attempted = Number(payload.attemptedSources ?? payload.sources ?? 0);
const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];
if (payload.status !== "SUCCESS" && payload.status !== "SKIPPED") {
  throw new Error(`Unexpected M4 bootstrap status: ${JSON.stringify(payload)}`);
}
if (selected < 0 || selected > 8 || attempted < 0 || attempted > 8) {
  throw new Error(`M4 bootstrap exceeded batch bound: ${JSON.stringify({ selected, attempted })}`);
}
if (payload.status === "SUCCESS" && selected !== 8) {
  throw new Error(`Expected first M4 bootstrap batch to select 8 sources, got ${selected}`);
}
const hardFailures = outcomes.filter(outcome => {
  if (outcome?.status === "ERROR") return true;
  const status = Number(outcome?.status);
  return Number.isFinite(status) && (status === 429 || status >= 500);
});
if (hardFailures.length) {
  throw new Error(`M4 bootstrap stopped on hard failure: ${JSON.stringify(hardFailures)}`);
}

const after = readState();
if (payload.status === "SUCCESS" && after.populatedSources <= before.populatedSources) {
  throw new Error(`M4 bootstrap produced no new populated source: ${JSON.stringify({ before, after, payload })}`);
}
if (after.gameRows < before.gameRows) {
  throw new Error(`M4 bootstrap game-row count regressed: ${JSON.stringify({ before, after })}`);
}

console.log(JSON.stringify({
  status: "M4_BOOTSTRAP_BATCH1_VERIFIED",
  selectedSources: selected,
  attemptedSources: attempted,
  providerGroups: Number(payload.providerGroups || 0),
  selectorRowsRead: Number(payload.selectorRowsRead || 0),
  before,
  after,
  newPopulatedSources: after.populatedSources - before.populatedSources,
  newGameRows: after.gameRows - before.gameRows
}));
