import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { collectionPlanAt } from "../src/collection-cadence.js";
import { m2LiveStatewideKeysForPlan, m2StatewideKeysForPlan, shouldRunVolleyballLiveResults } from "../src/milestone2-scheduled-worker.js";

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

test("weekday volleyball live window activates the generic semantic statewide result probe and bounded college core",()=>{
  const plan=collectionPlanAt(new Date("2026-09-03T23:00:00.000Z")); // Thursday 6 PM Central
  assert.equal(plan.kind,"volleyball-live-results");
  assert.equal(plan.runVolleyballLive,true);
  assert.equal(plan.runCore,true);
  assert.equal(plan.scope,"college-game-day");
  assert.equal(shouldRunVolleyballLiveResults(plan),true);
  assert.deepEqual(m2LiveStatewideKeysForPlan(plan),["volleyball-girls"]);
  // This is not a broad statewide maintenance sweep; the semantic probe owns HS
  // live collection while core is limited to due college game-day sources.
  assert.deepEqual(m2StatewideKeysForPlan(plan),[]);

  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/runStatewideLiveResultProbe/);
  assert.match(runner,/runStatewideLiveResultsPass/);
});

test("winter basketball live window uses the same generic semantic probe plus bounded college core",()=>{
  const plan=collectionPlanAt(new Date("2027-01-07T00:00:00.000Z")); // Wednesday 6 PM Central
  assert.equal(plan.kind,"statewide-live-results");
  assert.deepEqual(m2LiveStatewideKeysForPlan(plan),["basketball-boys","basketball-girls"]);
  assert.equal(shouldRunVolleyballLiveResults(plan),false);
  assert.equal(plan.runCore,true);
  assert.equal(plan.scope,"college-game-day");
  assert.deepEqual(m2StatewideKeysForPlan(plan),[]);
});

test("Friday result cadence preserves football capacity and adds an independent bounded college pass",()=>{
  const plan=collectionPlanAt(new Date("2026-09-05T02:30:00.000Z")); // Friday 9:30 PM Central
  assert.equal(plan.kind,"friday-football-results");
  assert.equal(plan.scope,"football-game-day");
  assert.equal(plan.activeResultMinutes,30);
  assert.equal(plan.runCollegeLive,true);
  assert.equal(shouldRunVolleyballLiveResults(plan),true);
  assert.deepEqual(m2StatewideKeysForPlan(plan),["football-boys"]);

  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/runCollegeLiveResultsPass/);
  assert.match(runner,/scope:"college-game-day"/);
  const scoped=fs.readFileSync(fileURLToPath(new URL("../src/scoped-cadence-runner.js",import.meta.url)),"utf8");
  assert.match(scoped,/if \(plan\.scope === "college-game-day"\)/);
  assert.match(scoped,/maxSources: 8/);
});

test("Saturday college cadence keeps statewide maintenance off while hourly volleyball probe remains eligible",()=>{
  const plan=collectionPlanAt(new Date("2026-09-05T17:00:00.000Z")); // Saturday noon Central
  assert.equal(plan.kind,"saturday-college-results");
  assert.equal(plan.scope,"college-game-day");
  assert.equal(plan.runCollegeLive,false);
  assert.equal(plan.runVolleyballLive,true);
  assert.equal(shouldRunVolleyballLiveResults(plan),true);
  assert.deepEqual(m2StatewideKeysForPlan(plan),[]);
});

test("Sunday catalog maintenance refreshes all six certified feeds and published volleyball membership",()=>{
  const plan=collectionPlanAt(new Date("2026-09-06T09:00:00.000Z")); // Sunday 4 AM Central
  assert.equal(plan.kind,"weekly-catalog-maintenance");
  assert.equal(plan.runCatalogMaintenance,true);
  assert.equal(shouldRunVolleyballLiveResults(plan),false);
  assert.deepEqual(m2StatewideKeysForPlan(plan),ALL);

  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/syncPublishedVolleyballConferenceMembership/);
  const membershipCall=runner.indexOf("await syncPublishedVolleyballConferenceMembership(env)");
  const statewideCall=runner.indexOf("await runStatewideSports(env");
  assert.ok(membershipCall>=0,"weekly membership sync must be wired");
  assert.ok(statewideCall>membershipCall,"conference membership must be materialized before statewide record rebuilds");
});
