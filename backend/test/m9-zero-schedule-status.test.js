import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeTeamStatusSeeds } from "../src/m4-public-worker.js";

const source = fs.readFileSync(new URL("../src/m4-public-worker.js", import.meta.url), "utf8");

test("school status keeps active teams before their first schedule row without amplifying the game query", () => {
  assert.match(source, /JOIN games g ON g\.team_id=t\.id/);
  assert.doesNotMatch(source, /LEFT JOIN games g/);
  assert.match(source, /FROM teams t[\s\S]*WHERE t\.school_id=\? AND t\.active=1 AND t\.season='2026'/);
  assert.doesNotMatch(source, /INDEXED BY idx_teams_school_active_season/);
  assert.match(source, /const statusRows = mergeTeamStatusSeeds\(resolvedRows, teamSeedResult\.results \|\| \[\]\)/);
  assert.match(source, /buildUnifiedTeamStatuses\(env, statusRows\)/);
});

test("status seeds add only teams missing from the real schedule rows", () => {
  const games = [
    { id:"game-1", reporting_team_id:"football", sport:"football", wins:2, losses:1 }
  ];
  const seeds = [
    { reporting_team_id:"football", sport:"football", wins:1, losses:1 },
    { reporting_team_id:"volleyball", sport:"volleyball", conference_id:"6a-central-volleyball" }
  ];

  const merged = mergeTeamStatusSeeds(games, seeds);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].wins, 2);
  assert.equal(merged[1].reporting_team_id, "volleyball");
  assert.equal(merged[1].conference_id, "6a-central-volleyball");
});