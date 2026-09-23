import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { collectionPlanAt } from "../src/collection-cadence.js";
import { m2LiveStatewideKeysForPlan, m2StatewideKeysForPlan, scheduledTouchedTeamIds, shouldRunVolleyballLiveResults, shouldRunHootensTeamPageCatchup } from "../src/milestone2-scheduled-worker.js";

const ALL=["football-boys","basketball-boys","basketball-girls","soccer-boys","soccer-girls","volleyball-girls"];

test("ordinary statewide windows refresh all six high-school bulk feeds without changing the core source cap",()=>{
  const plan=collectionPlanAt(new Date("2026-09-03T20:00:00.000Z")); // 3 PM Central Thursday
  assert.equal(plan.kind,"afternoon-schedule-check");
  assert.equal(plan.runStatewide,true);
  assert.equal(plan.runCore,true);
  assert.equal(plan.runIntegrityGate,true);
  assert.equal(plan.runStandingsReadiness,false);
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
  assert.equal(plan.runIntegrityGate,false);
  assert.equal(shouldRunVolleyballLiveResults(plan),true);
  assert.equal(shouldRunHootensTeamPageCatchup(plan),false,"historical team pages must not run every 30 minutes Friday");
  assert.deepEqual(m2StatewideKeysForPlan(plan),["football-boys"]);

  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/runCollegeLiveResultsPass/);
  assert.match(runner,/scope:"college-game-day"/);
  const scoped=fs.readFileSync(fileURLToPath(new URL("../src/scoped-cadence-runner.js",import.meta.url)),"utf8");
  assert.match(scoped,/if \(plan\.scope === "college-game-day"\)/);
  assert.match(scoped,/maxSources: 8/);
});

test("morning results get one bounded historical Hootens team-page catchup",()=>{
  const plan=collectionPlanAt(new Date("2026-09-12T11:00:00.000Z")); // Saturday 6 AM Central
  assert.equal(plan.kind,"morning-results");
  assert.equal(plan.runIntegrityGate,true);
  assert.equal(plan.runStandingsReadiness,true);
  assert.equal(shouldRunHootensTeamPageCatchup(plan),true);

  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/runHootensTeamPageCatchup/);
  assert.match(runner,/runHootensHistoricalCatchupPass/);
});

test("Saturday college cadence keeps statewide maintenance off while hourly volleyball probe remains eligible",()=>{
  const plan=collectionPlanAt(new Date("2026-09-05T17:00:00.000Z")); // Saturday noon Central
  assert.equal(plan.kind,"saturday-college-results");
  assert.equal(plan.scope,"college-game-day");
  assert.equal(plan.runCollegeLive,false);
  assert.equal(plan.runVolleyballLive,true);
  assert.equal(plan.runIntegrityGate,false);
  assert.equal(shouldRunVolleyballLiveResults(plan),true);
  assert.equal(shouldRunHootensTeamPageCatchup(plan),false);
  assert.deepEqual(m2StatewideKeysForPlan(plan),[]);
});

test("Sunday catalog maintenance refreshes all six certified feeds and published volleyball membership",()=>{
  const plan=collectionPlanAt(new Date("2026-09-06T09:00:00.000Z")); // Sunday 4 AM Central
  assert.equal(plan.kind,"weekly-catalog-maintenance");
  assert.equal(plan.runCatalogMaintenance,true);
  assert.equal(plan.runIntegrityGate,true);
  assert.equal(plan.runStandingsReadiness,true);
  assert.equal(shouldRunVolleyballLiveResults(plan),false);
  assert.equal(shouldRunHootensTeamPageCatchup(plan),false);
  assert.deepEqual(m2StatewideKeysForPlan(plan),ALL);

  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/syncPublishedVolleyballConferenceMembership/);
  const membershipCall=runner.indexOf("await syncPublishedVolleyballConferenceMembership(env)");
  const statewideCall=runner.indexOf("await runStatewideSports(env");
  assert.ok(membershipCall>=0,"weekly membership sync must be wired");
  assert.ok(statewideCall>membershipCall,"conference membership must be materialized before statewide record rebuilds");
});


test("closing Friday and Saturday live windows run the integrity gate once after collection",()=>{
  const fridayClose=collectionPlanAt(new Date("2026-09-05T06:00:00.000Z")); // Saturday 1 AM Central
  assert.equal(fridayClose.kind,"friday-football-results");
  assert.equal(fridayClose.runIntegrityGate,true);

  const saturdayClose=collectionPlanAt(new Date("2026-09-06T07:00:00.000Z")); // Sunday 2 AM Central
  assert.equal(saturdayClose.kind,"saturday-college-results");
  assert.equal(saturdayClose.runIntegrityGate,true);

  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/runStatewideIntegrityGate/);
  assert.match(runner,/runIntegrityGatePass/);
});


test("scheduled integrity passes standings readiness only on bounded morning and weekly windows",()=>{
  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.match(runner,/auditStandings:Boolean\(plan\.runStandingsReadiness\)/);
  const afternoon=collectionPlanAt(new Date("2026-09-03T20:00:00.000Z"));
  const evening=collectionPlanAt(new Date("2026-09-04T04:00:00.000Z"));
  assert.equal(afternoon.runStandingsReadiness,false);
  assert.equal(evening.runStandingsReadiness,false);
});


test("scheduled touched-team propagation unions every collector path without duplicates",()=>{
  assert.deepEqual(scheduledTouchedTeamIds(
    [{touchedTeamIds:["df-a","df-b"]}],
    {touchedTeamIds:["df-b","df-c"]},
    {outcomes:[{payload:{touchedTeamIds:["df-d"]}},{payload:{touchedTeamIds:["df-e","df-a"]}}]},
    {payload:{touchedTeamIds:["df-f"]}}
  ),["df-a","df-b","df-c","df-d","df-e","df-f"]);
});

test("Milestone 2 carries exact touched team IDs through statewide and scoped scheduled results",()=>{
  const runner=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  const scoped=fs.readFileSync(fileURLToPath(new URL("../src/scoped-cadence-runner.js",import.meta.url)),"utf8");
  assert.match(runner,/touchedTeamIds:result\.touchedTeamIds\|\|\[\]/);
  assert.match(runner,/scheduledTouchedTeamIds\(/);
  assert.match(scoped,/payload\?\.touchedTeamIds/);
});


test("logo wrapper does not pre-consume volleyball live changes before Milestone 2",()=>{
  const logo=fs.readFileSync(fileURLToPath(new URL("../src/logo-bootstrap-worker.js",import.meta.url)),"utf8");
  const milestone=fs.readFileSync(fileURLToPath(new URL("../src/milestone2-scheduled-worker.js",import.meta.url)),"utf8");
  assert.doesNotMatch(logo,/runVolleyballLiveResultProbe/);
  assert.doesNotMatch(logo,/runVolleyballLiveTick/);
  assert.doesNotMatch(logo,/collectionPlanAt/);
  assert.match(logo,/async scheduled\(controller, env, ctx\) \{\s*return app\.scheduled\(controller, env, ctx\);\s*\}/);
  assert.match(milestone,/runStatewideLiveResultProbe/);
  assert.match(milestone,/touchedTeamIds:result\.touchedTeamIds\|\|\[\]/);
});
