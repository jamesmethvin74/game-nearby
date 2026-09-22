import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { collectionPlanAt } from "../src/collection-cadence.js";
import { COLLEGE_LATE_FINAL_LOOKBACK_MINUTES, scopePolicy } from "../src/scoped-cadence-runner.js";

function source(relative) {
  return fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("M11 keeps ordinary collection bounded at four sources", () => {
  const plan = collectionPlanAt(new Date("2026-09-14T11:00:00.000Z")); // Monday 6 AM Central
  assert.equal(plan.kind, "morning-results");
  assert.equal(plan.scope, "all");
  assert.equal(scopePolicy(plan).maxSources, 4);
});

test("M11 keeps Friday football and college live queues independent", () => {
  const plan = collectionPlanAt(new Date("2026-09-12T02:30:00.000Z")); // Friday 9:30 PM Central
  assert.equal(plan.kind, "friday-football-results");
  assert.equal(plan.scope, "football-game-day");
  assert.equal(plan.runCollegeLive, true);
  assert.equal(scopePolicy(plan).maxSources, 16);
  assert.equal(scopePolicy({ ...plan, scope: "college-game-day" }).maxSources, 8);
});

test("M11 treats late Saturday college finals as live work through 2 AM Sunday", () => {
  const saturdayNoon = collectionPlanAt(new Date("2026-09-12T17:00:00.000Z")); // Saturday noon Central
  assert.equal(saturdayNoon.kind, "saturday-college-results");
  assert.equal(saturdayNoon.scope, "college-game-day");
  assert.equal(saturdayNoon.activeResultMinutes, 30);

  const sunday0130 = collectionPlanAt(new Date("2026-09-13T06:30:00.000Z")); // Sunday 1:30 AM Central
  assert.equal(sunday0130.kind, "saturday-college-results");
  assert.equal(sunday0130.scope, "college-game-day");

  const sunday0200 = collectionPlanAt(new Date("2026-09-13T07:00:00.000Z")); // Sunday 2:00 AM Central
  assert.equal(sunday0200.kind, "saturday-college-results");

  const sunday0230 = collectionPlanAt(new Date("2026-09-13T07:30:00.000Z")); // Sunday 2:30 AM Central
  assert.equal(sunday0230, null);
});

test("M11 late-final college selector remains bounded and index-aligned", () => {
  const policy = scopePolicy({ scope: "college-game-day", activeResultMinutes: 30 });
  assert.equal(policy.maxSources, 8);
  assert.equal(policy.dueMode, "active-result");
  assert.equal(COLLEGE_LATE_FINAL_LOOKBACK_MINUTES, 900);
  assert.match(policy.gameWindow, /gx\.source_id=src\.id/);
  assert.match(policy.gameWindow, /-900 minutes/);
  assert.match(policy.gameWindow, /t\.sport='football'.*-120 minutes/s);
  assert.match(policy.gameWindow, /t\.sport='basketball'.*-75 minutes/s);

  const indexes = source("../migrations/0012_d1_read_budget_indexes.sql");
  assert.match(indexes, /idx_games_source_time[\s\S]*ON games\(source_id, scheduled_at\)/);
});

test("M11 normal collectors preserve final -> record -> touched-conference standings propagation", () => {
  const core = source("../src/index.js");
  const records = source("../src/record-rebuild.js");
  const statewide = source("../src/dragonfly-certified-statewide.js");
  const standings = source("../src/calculated-standings.js");

  assert.match(core, /const touchedTeamIds=new Set\(\[String\(source\.team_id\)\]\)/);
  assert.match(core, /await reconcileSourceGames\(env,source\.id,touchedTeamIds\);[\s\S]*await rebuildTeamRecords\(env,\[\.\.\.touchedTeamIds\],checkedAt\);/);
  assert.match(core, /return \{sourceId:source\.id,status:"SUCCESS"[\s\S]*touchedTeamIds:\[\.\.\.touchedTeamIds\]\.sort\(\)/);
  assert.match(records, /rebuildStandingsForTeams\(env, \[teamId\], calculatedAt\)/);
  assert.match(records, /rebuildStandingsForTeams\(env, built\.map\(item => item\.team\.id\), calculatedAt\)/);
  assert.match(statewide, /rebuildTeamRecords\(env,rows\.touchedTeamIds/);
  assert.match(standings, /touchedCohorts/);
  assert.match(standings, /persistCalculatedStandings/);
});

test("M11 source selection stays scoped and D1 usage visibility remains intact", () => {
  const runner = source("../src/scoped-cadence-runner.js");
  const telemetry = source("../src/d1-usage-public-worker.js");

  assert.match(runner, /ORDER BY src\.last_checked_at IS NOT NULL, src\.last_checked_at/);
  assert.match(runner, /LIMIT \?/);
  assert.match(runner, /rowsRead: Number\(selection\.meta\?\.rows_read/);
  assert.match(runner, /rowsWritten: Number\(selection\.meta\?\.rows_written/);
  assert.match(telemetry, /loadD1Usage/);
  assert.match(telemetry, /\/api\/v1\/d1-usage/);
  assert.match(telemetry, /async scheduled\(controller, env, ctx\)[\s\S]*app\.scheduled\(controller, env, ctx\)/);
});
