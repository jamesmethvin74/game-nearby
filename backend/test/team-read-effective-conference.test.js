import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const teamReadSource=fs.readFileSync(new URL("../src/team-read-worker.js",import.meta.url),"utf8");
const schoolReadSource=fs.readFileSync(new URL("../src/m4-public-worker.js",import.meta.url),"utf8");
const inferenceSource=fs.readFileSync(new URL("../src/conference-game-inference.js",import.meta.url),"utf8");

test("schedule reads use set-based shared-conference inference",()=>{
  for (const source of [teamReadSource,schoolReadSource]) {
    assert.match(source,/attachEffectiveConferenceGames/);
    assert.doesNotMatch(source,/conference_id IS NOT NULL AND EXISTS\s*\(/);
  }
  assert.match(inferenceSource,/FROM teams INDEXED BY idx_teams_school_active_season/);
  assert.match(inferenceSource,/school_id IN \(\$\{placeholders\}\)/);
  assert.match(inferenceSource,/membershipKey\(opponentId, row\.sport, row\.gender, row\.season, row\.conference_id\)/);
  assert.match(teamReadSource,/conference_game:\s*Number\(row\.effective_conference_game \?\? row\.conference_game/);
});
