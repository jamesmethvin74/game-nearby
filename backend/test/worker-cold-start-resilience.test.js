import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("public API reads perform no request-time maintenance", () => {
  const fetchStart = worker.indexOf("async fetch(request, env, ctx)");
  const scheduledStart = worker.indexOf("async scheduled(controller, env, ctx)");
  assert.ok(fetchStart >= 0 && scheduledStart > fetchStart, "public fetch block not found");
  const fetchBlock = worker.slice(fetchStart, scheduledStart);
  assert.doesNotMatch(fetchBlock, /ensureStatewideSchema/);
  assert.doesNotMatch(fetchBlock, /rebuildStatewideRecords/);
  assert.doesNotMatch(fetchBlock, /ensureInitialStatewideData/);
  assert.doesNotMatch(fetchBlock, /queueStartupMaintenance/);
  assert.doesNotMatch(fetchBlock, /enrichMaxPrepsSchoolMascots/);
  assert.doesNotMatch(worker, /ensureLiveConfig/);
  assert.doesNotMatch(worker, /env\.DB\.batch\(/);

  const scheduledBlock = worker.slice(scheduledStart);
  assert.match(scheduledBlock, /await\s+ensureStatewideSchema\(env\)/);
  assert.match(scheduledBlock, /await\s+syncMaxPrepsSchoolBranding\(env\)/);
  assert.match(scheduledBlock, /await\s+runDragonFlyStatewideCollection\(env/);
});

test("authoritative statewide ingest still rebuilds and persists team records", () => {
  assert.match(statewide, /await\s+rebuildStatewideRecords\(env,checkedAt\)/);
});
