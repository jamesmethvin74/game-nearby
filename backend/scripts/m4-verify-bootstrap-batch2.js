import fs from "node:fs";

function readD1(path) {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const row = envelopes.flatMap(item => item?.results || []).find(Boolean);
  if (!row) throw new Error(`No D1 result row in ${path}`);
  return {
    populatedSources: Number(row.populated_sources || 0),
    gameRows: Number(row.game_rows || 0)
  };
}

const before = readD1(".m4-b2-before.json");
const after = readD1(".m4-b2-after.json");
const payload = JSON.parse(fs.readFileSync(".m4-b2-result.json", "utf8"));

if (payload.status !== "SUCCESS" && payload.status !== "SKIPPED") {
  throw new Error(`Unexpected Batch 2 status: ${JSON.stringify(payload)}`);
}

const selected = Number(payload.selectedSources ?? payload.sources ?? 0);
const attempted = Number(payload.attemptedSources ?? payload.sources ?? 0);
if (selected < 0 || selected > 8 || attempted < 0 || attempted > 8) {
  throw new Error(`Batch 2 exceeded max-8 bound: ${JSON.stringify({ selected, attempted })}`);
}
if (payload.status === "SUCCESS" && selected < 1) {
  throw new Error(`Successful Batch 2 selected no sources: ${JSON.stringify(payload)}`);
}

const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];
const hardFailures = outcomes.filter(outcome => {
  if (outcome?.status === "ERROR") return true;
  const status = Number(outcome?.status);
  return Number.isFinite(status) && (status === 429 || status >= 500);
});
if (hardFailures.length) {
  throw new Error(`Batch 2 hard failure: ${JSON.stringify(hardFailures)}`);
}

if (payload.status === "SUCCESS" && after.populatedSources <= before.populatedSources) {
  throw new Error(`Batch 2 did not increase populated sources: ${JSON.stringify({ before, after })}`);
}
if (after.gameRows < before.gameRows) {
  throw new Error(`Batch 2 game rows regressed: ${JSON.stringify({ before, after })}`);
}

console.log(JSON.stringify({
  status: "M4_BOOTSTRAP_BATCH2_VERIFIED",
  selectedSources: selected,
  attemptedSources: attempted,
  providerGroups: Number(payload.providerGroups || 0),
  selectorRowsRead: Number(payload.selectorRowsRead || 0),
  before,
  after,
  newPopulatedSources: after.populatedSources - before.populatedSources,
  newGameRows: after.gameRows - before.gameRows
}));
