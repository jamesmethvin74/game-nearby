import fs from "node:fs";

const [beforePath, payloadPath, afterPath] = process.argv.slice(2);
if (!beforePath || !payloadPath || !afterPath) {
  throw new Error("Expected before, payload, and after JSON paths");
}

function readState(path) {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const row = envelopes.flatMap(item => item?.results || []).find(Boolean);
  if (!row) throw new Error(`State query returned no row: ${path}`);
  return {
    populatedSources: Number(row.populated_sources || 0),
    gameRows: Number(row.game_rows || 0)
  };
}

const before = readState(beforePath);
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const after = readState(afterPath);

const selected = Number(payload.selectedSources ?? payload.sources ?? 0);
const attempted = Number(payload.attemptedSources ?? payload.sources ?? 0);
const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];

if (payload.status !== "SUCCESS" && payload.status !== "SKIPPED") {
  throw new Error(`Unexpected M4 Batch 2 status: ${JSON.stringify(payload)}`);
}
if (selected < 0 || selected > 8 || attempted < 0 || attempted > 8) {
  throw new Error(`M4 Batch 2 exceeded batch bound: ${JSON.stringify({ selected, attempted })}`);
}
if (payload.status === "SUCCESS" && selected < 1) {
  throw new Error(`M4 Batch 2 reported SUCCESS without selecting a source: ${JSON.stringify(payload)}`);
}
if (payload.status === "SKIPPED" && (selected !== 0 || attempted !== 0)) {
  throw new Error(`M4 Batch 2 SKIPPED with unexpected work: ${JSON.stringify({ selected, attempted, payload })}`);
}

const hardFailures = outcomes.filter(outcome => {
  if (outcome?.status === "ERROR") return true;
  const status = Number(outcome?.status);
  return Number.isFinite(status) && (status === 429 || status >= 500);
});
if (hardFailures.length) {
  throw new Error(`M4 Batch 2 stopped on hard failure: ${JSON.stringify(hardFailures)}`);
}

if (payload.status === "SUCCESS" && after.populatedSources <= before.populatedSources) {
  throw new Error(`M4 Batch 2 produced no new populated source: ${JSON.stringify({ before, after, payload })}`);
}
if (after.gameRows < before.gameRows) {
  throw new Error(`M4 Batch 2 game-row count regressed: ${JSON.stringify({ before, after })}`);
}

console.log(JSON.stringify({
  status: "M4_BOOTSTRAP_BATCH2_V3_VERIFIED",
  selectedSources: selected,
  attemptedSources: attempted,
  providerGroups: Number(payload.providerGroups || 0),
  selectorRowsRead: Number(payload.selectorRowsRead || 0),
  before,
  after,
  newPopulatedSources: after.populatedSources - before.populatedSources,
  newGameRows: after.gameRows - before.gameRows
}));
