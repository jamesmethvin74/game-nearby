import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { collectionPlanAt } from "../src/collection-cadence.js";
import { m2StatewideKeysForPlan } from "../src/milestone2-scheduled-worker.js";

const ALL=["football-boys","basketball-boys","basketball-girls","soccer-boys","soccer-girls","volleyball-girls"];

test("ordinary statewide windows refresh all six high-school bulk feeds without changing the core source cap",()=>{
  const plan=collectionPlanAt(new Date("2026-09-03T20:00:00.000Z")); // 3 PM Central Thursday
  assert.equal(plan.kind,"afternoon-schedule-check");
  assert.equal(plan.runStatewide,true);
  assert.equal(plan.runCore,true);
  assert.deepEqual(m2StatewideKeysForPlan(plan),ALL);

  const scoped=fs.readFileSync(fileURLToPath(new URL("../src/scoped-cadence-runner.js",import.meta.url)),"utf8");
  assert.match(scoped,/ORDINARY_MAX_SOURCES_PER_RUN = 4/);
});

test("Friday result cadence adds one statewide football bulk refresh and preserves 30-minute core polling",()=>{
  const plan=collectionPlanAt(new Date("2026-09-05T02:30:00.000Z")); // Friday 9:30 PM Central
  assert.equal(plan.kind,"friday-football-results");
  assert.equal(plan.scope,"football-game-day");
  assert.equal(plan.activeResultMinutes,30);
  assert.deepEqual(m2StatewideKeysForPlan(plan),["football-boys"]);
});

test("Saturday college cadence does not run high-school statewide feeds",()=>{
  const plan=collectionPlanAt(new Date("2026-09-05T17:00:00.000Z")); // Saturday noon Central
  assert.equal(plan.kind,"saturday-college-results");
  assert.equal(plan.scope,"college-game-day");
  assert.deepEqual(m2StatewideKeysForPlan(plan),[]);
});

test("Sunday catalog maintenance refreshes all six certified feeds",()=>{
  const plan=collectionPlanAt(new Date("2026-09-06T09:00:00.000Z")); // Sunday 4 AM Central
  assert.equal(plan.kind,"weekly-catalog-maintenance");
  assert.equal(plan.runCatalogMaintenance,true);
  assert.deepEqual(m2StatewideKeysForPlan(plan),ALL);
});
