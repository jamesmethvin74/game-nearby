import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("public API cold start does not synchronously gate on runtime seed or statewide record repair", () => {
  assert.doesNotMatch(worker, /ensureLiveConfig/);
  assert.doesNotMatch(worker, /env\.DB\.batch\(/);
  assert.doesNotMatch(worker, /await\s+rebuildStatewideRecords/);
  assert.match(worker, /queueRecordRepair/);
  assert.match(worker, /record rebuild background repair failed/);
});

test("authoritative statewide ingest still rebuilds and persists team records", () => {
  assert.match(statewide, /await\s+rebuildStatewideRecords\(env,checkedAt\)/);
});
