import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFinalResultTruth, sanitizeFinalForCanonical } from "../src/final-result-truth.js";
import { evaluateScheduleRecordTruth } from "../src/schedule-response-normalizer.js";

function volleyballFinal(result, teamScore, opponentScore, extra = {}) {
  return {
    id:"pool-play",
    school_id:"sample-school",
    sport:"volleyball",
    gender:"girls",
    scheduled_at:"2026-08-29T17:00:00.000Z",
    opponent:"Sample Opponent",
    status:"FINAL",
    result,
    team_score:teamScore,
    opponent_score:opponentScore,
    counts_for_record:1,
    ...extra
  };
}

test("authoritative volleyball 1-1 pool-play tie is verified and counts as a tie", () => {
  const row=volleyballFinal("T",1,1);
  const evaluated=evaluateFinalResultTruth(row);
  assert.equal(evaluated.state,"VERIFIED");
  assert.equal(evaluated.row.result,"T");
  assert.equal(evaluated.row.team_score,1);
  assert.equal(evaluated.row.opponent_score,1);

  const canonical=sanitizeFinalForCanonical(row);
  assert.equal(canonical.team_score,1);
  assert.equal(canonical.opponent_score,1);

  const truth=evaluateScheduleRecordTruth([row]);
  assert.equal(truth.state,"VERIFIED");
  assert.equal(truth.unresolved_finals,0);
  assert.equal(truth.derived_record.ties,1);
  assert.equal(truth.derived_record.scored_finals,1);
});

test("volleyball T 0-0 remains an unresolved legacy placeholder", () => {
  const evaluated=evaluateFinalResultTruth(volleyballFinal("T",0,0));
  assert.equal(evaluated.state,"UNRESOLVED");
  assert.equal(evaluated.reason,"VOLLEYBALL_TIE_PLACEHOLDER");
  assert.equal(evaluated.row.result,null);

  const truth=evaluateScheduleRecordTruth([volleyballFinal("T",0,0)]);
  assert.equal(truth.state,"UNRESOLVED");
  assert.equal(truth.unresolved_finals,1);
  assert.equal(truth.derived_record.scored_finals,0);
});

test("stale volleyball explicit T does not override independently oriented non-tied score", () => {
  const evaluated=evaluateFinalResultTruth(volleyballFinal("T",0,3));
  assert.equal(evaluated.state,"VERIFIED");
  assert.equal(evaluated.reason,"VOLLEYBALL_TIE_PLACEHOLDER_IGNORED");
  assert.equal(evaluated.row.result,"L");
  assert.equal(evaluated.row.team_score,0);
  assert.equal(evaluated.row.opponent_score,3);
});
