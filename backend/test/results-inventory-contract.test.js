import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("statewide ingestion rebuilds persistent records while request startup queues maintenance", () => {
  assert.match(statewide, /await rebuildStatewideRecords\(env,checkedAt\)/);
  assert.match(worker, /queueStartupMaintenance\(env,ctx\)/);
  assert.match(worker, /await rebuildStatewideRecords\(env, new Date\(\)\.toISOString\(\)\)/);
  const fetchStart = worker.indexOf("async fetch(request, env, ctx)");
  const scheduledStart = worker.indexOf("async scheduled(controller, env, ctx)");
  assert.ok(fetchStart >= 0 && scheduledStart > fetchStart, "public fetch block not found");
  const fetchBlock = worker.slice(fetchStart, scheduledStart);
  assert.doesNotMatch(fetchBlock, /await\s+ensureStatewideSchema|await\s+ensureLiveConfig|await\s+rebuildStatewideRecords/);
});
