import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FINAL_MISSING_SCORE_CASES,
  classifyFinalMissingScoreRows,
  FINAL_MISSING_SCORE_FINGERPRINT_PREFIX,
  MAX_PLAN_READS,
  MAX_DIRECT_WRITES
} from "../src/final-missing-score-repair.js";
import {
  FINAL_MISSING_SCORE_PLAN_PATH,
  FINAL_MISSING_SCORE_EXECUTE_PATH
} from "../src/logo-bootstrap-worker.js";

function rows({ complete = false } = {}) {
  return FINAL_MISSING_SCORE_CASES.flatMap(item => [
    {
      canonical_id:item.canonicalId,
      canonical_status:"FINAL",
      home_school_id:item.homeSchoolId,
      away_school_id:item.awaySchoolId,
      home_score:complete ? item.homeScore : null,
      away_score:item.awayScore,
      active_conflicts:0,
      game_id:`${item.key}:home`,
      reporting_team_id:item.homeTeamId,
      game_status:"FINAL",
      team_score:complete ? item.homeScore : null,
      opponent_score:item.awayScore,
      game_result:complete ? "L" : null
    },
    {
      canonical_id:item.canonicalId,
      canonical_status:"FINAL",
      home_school_id:item.homeSchoolId,
      away_school_id:item.awaySchoolId,
      home_score:complete ? item.homeScore : null,
      away_score:item.awayScore,
      active_conflicts:0,
      game_id:`${item.key}:away`,
      reporting_team_id:item.awayTeamId,
      game_status:"FINAL",
      team_score:item.awayScore,
      opponent_score:complete ? item.homeScore : null,
      game_result:complete ? "W" : null
    }
  ]);
}

test("the four audit flags collapse to exactly two reciprocal canonical finals", () => {
  assert.equal(FINAL_MISSING_SCORE_CASES.length, 2);
  assert.equal(new Set(FINAL_MISSING_SCORE_CASES.map(item => item.canonicalId)).size, 2);
  assert.equal(new Set(FINAL_MISSING_SCORE_CASES.flatMap(item => [item.homeTeamId,item.awayTeamId])).size, 4);
});

test("exact observed partial state is safe and requires two apply actions", () => {
  const result = classifyFinalMissingScoreRows(rows());
  assert.equal(result.safe, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.cases.map(item => item.action), ["apply","apply"]);
});

test("already-correct reciprocal finals are idempotent", () => {
  const result = classifyFinalMissingScoreRows(rows({ complete:true }));
  assert.equal(result.safe, true);
  assert.deepEqual(result.cases.map(item => item.action), ["already_complete","already_complete"]);
});

test("unexpected score drift fails closed instead of guessing", () => {
  const changed = rows();
  changed[0] = { ...changed[0], team_score:1 };
  const result = classifyFinalMissingScoreRows(changed);
  assert.equal(result.safe, false);
  assert.equal(result.cases[0].action, "unsafe");
  assert.match(result.reasons.join(" "), /score state no longer matches/);
});

test("repair is tightly bounded and fingerprint gated", async () => {
  assert.equal(FINAL_MISSING_SCORE_FINGERPRINT_PREFIX, "final-missing-score-two-games-v1");
  assert.ok(MAX_PLAN_READS <= 500);
  assert.equal(MAX_DIRECT_WRITES, 6);
  assert.match(FINAL_MISSING_SCORE_PLAN_PATH, /final-missing-score-plan/);
  assert.match(FINAL_MISSING_SCORE_EXECUTE_PATH, /final-missing-score-execute/);
  const source = await readFile(new URL("../src/final-missing-score-repair.js", import.meta.url), "utf8");
  assert.match(source, /fingerprint !== plan\.fingerprint/);
  assert.match(source, /canonical write count mismatch/);
  assert.match(source, /game write count mismatch/);
  assert.match(source, /direct write fuse tripped/);
  assert.match(source, /rebuildTeamRecords\(env, touchedTeamIds/);
  assert.doesNotMatch(source, /for \([^\n]+\)\s*\{[^}]*env\.DB/s);
});
