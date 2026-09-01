import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("statewide ingestion rebuilds persistent records while worker startup only queues repair", () => {
  assert.match(statewide, /await rebuildStatewideRecords\(env,checkedAt\)/);
  assert.match(worker, /queueRecordRepair\(env,ctx\)/);
  assert.match(worker, /rebuildStatewideRecords\(env, calculatedAt\)/);
  const ensureStart = worker.indexOf("async function ensureLiveConfig");
  const ensureEnd = worker.indexOf("async function displayNamesForGames");
  assert.ok(ensureStart >= 0 && ensureEnd > ensureStart, "ensureLiveConfig block not found");
  assert.doesNotMatch(worker.slice(ensureStart, ensureEnd), /await\s+rebuildStatewideRecords/);
});
