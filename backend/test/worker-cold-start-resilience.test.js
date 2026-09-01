import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("public API cold start never gates reads on schema seed or record maintenance", () => {
  const fetchStart = worker.indexOf("async fetch(request, env, ctx)");
  const scheduledStart = worker.indexOf("async scheduled(controller, env, ctx)");
  assert.ok(fetchStart >= 0 && scheduledStart > fetchStart, "public fetch block not found");
  const fetchBlock = worker.slice(fetchStart, scheduledStart);
  assert.doesNotMatch(fetchBlock, /await\s+ensureStatewideSchema/);
  assert.doesNotMatch(fetchBlock, /await\s+ensureLiveConfig/);
  assert.doesNotMatch(fetchBlock, /await\s+rebuildStatewideRecords/);
  assert.match(fetchBlock, /queueStartupMaintenance\(env,ctx\)/);
  assert.match(worker, /startup maintenance failed; serving last-known-good data/);
});

test("authoritative statewide ingest still rebuilds and persists team records", () => {
  assert.match(statewide, /await\s+rebuildStatewideRecords\(env,checkedAt\)/);
});
