import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");
const volleyballSeed = await readFile(new URL("../migrations/0002_add_inseason_volleyball.sql", import.meta.url), "utf8");
const conferenceSeed = await readFile(new URL("../migrations/0003_fix_volleyball_conferences_and_sources.sql", import.meta.url), "utf8");

test("statewide ingestion owns persistent rebuild while public reads stay maintenance-free", () => {
  assert.match(statewide, /await rebuildStatewideRecords\(env,checkedAt\)/);
  const fetchStart = worker.indexOf("async fetch(request, env, ctx)");
  const scheduledStart = worker.indexOf("async scheduled(controller, env, ctx)");
  assert.ok(fetchStart >= 0 && scheduledStart > fetchStart, "public fetch block not found");
  const fetchBlock = worker.slice(fetchStart, scheduledStart);
  assert.doesNotMatch(fetchBlock, /rebuildStatewideRecords|ensureStatewideSchema|ensureInitialStatewideData|queueStartupMaintenance/);

  const maintenanceStart = worker.indexOf("async function runCatalogMaintenance");
  const refreshStart = worker.indexOf("async function runStatewideRefresh");
  assert.ok(maintenanceStart >= 0 && refreshStart > maintenanceStart, "weekly maintenance block not found");
  const maintenanceBlock = worker.slice(maintenanceStart, refreshStart);
  assert.match(maintenanceBlock, /await ensureStatewideSchema\(env\)/);
  assert.match(worker.slice(scheduledStart), /return runScheduledPlan\(controller,env,ctx\)/);
});

test("runtime no longer reseeds pilot config on every fresh Worker isolate", () => {
  assert.doesNotMatch(worker, /ensureLiveConfig/);
  assert.doesNotMatch(worker, /env\.DB\.batch\(/);
  assert.match(volleyballSeed, /uca-volleyball-2026/);
  assert.match(volleyballSeed, /conway-volleyball-2026/);
  assert.match(conferenceSeed, /greenbrier-volleyball-2026/);
  assert.match(conferenceSeed, /vilonia-volleyball-2026/);
});
