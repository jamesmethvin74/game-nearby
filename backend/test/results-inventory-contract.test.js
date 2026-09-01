import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");
const volleyballSeed = await readFile(new URL("../migrations/0002_add_inseason_volleyball.sql", import.meta.url), "utf8");
const conferenceSeed = await readFile(new URL("../migrations/0003_fix_volleyball_conferences_and_sources.sql", import.meta.url), "utf8");

test("statewide ingestion owns record rebuild while public cold start does not gate on repair", () => {
  assert.match(statewide, /await rebuildStatewideRecords\(env,checkedAt\)/);
  assert.match(worker, /queueRecordRepair\(env,ctx\)/);
  assert.match(worker, /rebuildStatewideRecords\(env, calculatedAt\)/);
  assert.doesNotMatch(worker, /await\s+rebuildStatewideRecords/);
});

test("runtime no longer reseeds pilot config on every fresh Worker isolate", () => {
  assert.doesNotMatch(worker, /ensureLiveConfig/);
  assert.doesNotMatch(worker, /env\.DB\.batch\(/);
  assert.match(volleyballSeed, /uca-volleyball-2026/);
  assert.match(volleyballSeed, /conway-volleyball-2026/);
  assert.match(conferenceSeed, /greenbrier-volleyball-2026/);
  assert.match(conferenceSeed, /vilonia-volleyball-2026/);
});
