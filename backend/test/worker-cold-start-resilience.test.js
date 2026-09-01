import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("normal public API reads perform no request-time maintenance", () => {
  const fetchStart = worker.indexOf("async fetch(request, env, ctx)");
  const scheduledStart = worker.indexOf("async scheduled(controller, env, ctx)");
  assert.ok(fetchStart >= 0 && scheduledStart > fetchStart, "public fetch block not found");
  const fetchBlock = worker.slice(fetchStart, scheduledStart);
  assert.doesNotMatch(fetchBlock, /ensureStatewideSchema/);
  assert.doesNotMatch(fetchBlock, /rebuildStatewideRecords/);
  assert.doesNotMatch(fetchBlock, /ensureInitialStatewideData/);
  assert.doesNotMatch(fetchBlock, /queueStartupMaintenance/);
  assert.doesNotMatch(worker, /ensureLiveConfig/);
  assert.doesNotMatch(worker, /env\.DB\.batch\(/);

  const scheduledBlock = worker.slice(scheduledStart);
  assert.match(scheduledBlock, /await\s+ensureStatewideSchema\(env\)/);
  assert.match(scheduledBlock, /await\s+syncMaxPrepsSchoolBranding\(env\)/);
  assert.match(scheduledBlock, /await\s+runDragonFlyStatewideCollection\(env/);
});

test("nearby games may use a bounded read-only query without startup maintenance", () => {
  assert.match(worker, /path==="\/api\/v1\/games"/);
  assert.match(worker, /listNearbyGamesBounded/);
  assert.match(worker, /LEFT JOIN team_records r ON r\.team_id=t\.id/);
  assert.match(worker, /LEFT JOIN standings st ON st\.team_id=t\.id/);
  assert.match(worker, /COALESCE\(ce\.latitude,g\.latitude\) BETWEEN \? AND \?/);
  assert.match(worker, /r\.wins,r\.losses,r\.ties,r\.conference_wins,r\.conference_losses,r\.conference_ties/);
});

test("explicit branding report remains allowed to refresh branding on demand", () => {
  assert.match(worker, /path==="\/api\/v1\/branding\/report"/);
  assert.match(worker, /await syncMaxPrepsSchoolBranding\(env\)/);
  assert.match(worker, /enrichMaxPrepsSchoolMascots\(env,\{limit:12\}\)/);
});

test("authoritative statewide ingest still rebuilds and persists team records", () => {
  assert.match(statewide, /await\s+rebuildStatewideRecords\(env,checkedAt\)/);
});
