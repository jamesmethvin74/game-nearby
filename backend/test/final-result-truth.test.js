import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFinalResultTruth, normalizeFinalResultTruth } from "../src/final-result-truth.js";
import { parseResult } from "../src/parser-core.js";
import { evaluateScheduleRecordTruth, recordFromScheduleRows } from "../src/schedule-response-normalizer.js";

function final(result, teamScore, opponentScore, extra = {}) {
  return {
    school_id:"test-school",
    sport:"football",
    gender:"boys",
    scheduled_at:extra.scheduled_at || "2026-09-01T00:00:00.000Z",
    opponent:extra.opponent || "Opponent",
    status:"FINAL",
    result,
    team_score:teamScore,
    opponent_score:opponentScore,
    counts_for_record:1,
    ...extra
  };
}

test("shared invariant preserves explicit W with team-first score", () => {
  const evaluated = evaluateFinalResultTruth(final("W",31,14));
  assert.equal(evaluated.state,"VERIFIED");
  assert.equal(evaluated.corrected,false);
  assert.equal(evaluated.row.team_score,31);
  assert.equal(evaluated.row.opponent_score,14);
  assert.equal(evaluated.row.result,"W");
});

test("shared invariant preserves explicit L with team-first score", () => {
  const evaluated = evaluateFinalResultTruth(final("L",10,43));
  assert.equal(evaluated.state,"VERIFIED");
  assert.equal(evaluated.corrected,false);
  assert.equal(evaluated.row.team_score,10);
  assert.equal(evaluated.row.opponent_score,43);
});

test("shared invariant flips winner-first loss score into reporting-team orientation", () => {
  const evaluated = evaluateFinalResultTruth(final("L",43,10));
  assert.equal(evaluated.state,"VERIFIED");
  assert.equal(evaluated.corrected,true);
  assert.equal(evaluated.reason,"EXPLICIT_RESULT_ORIENTATION_CORRECTED");
  assert.equal(evaluated.row.team_score,10);
  assert.equal(evaluated.row.opponent_score,43);
  assert.equal(evaluated.row.result,"L");
});

test("shared invariant flips winner-first win score when first value contradicts W", () => {
  const evaluated = evaluateFinalResultTruth(final("W",14,42));
  assert.equal(evaluated.state,"VERIFIED");
  assert.equal(evaluated.corrected,true);
  assert.equal(evaluated.row.team_score,42);
  assert.equal(evaluated.row.opponent_score,14);
  assert.equal(evaluated.row.result,"W");
});

test("ties require equal scores and contradictory ties fail closed", () => {
  assert.equal(evaluateFinalResultTruth(final("T",2,2)).state,"VERIFIED");
  const contradiction = evaluateFinalResultTruth(final("T",2,3));
  assert.equal(contradiction.state,"CONTRADICTORY");
  assert.equal(contradiction.reason,"EXPLICIT_TIE_SCORE_CONTRADICTION");
});

test("missing explicit result derives result from already team-oriented numeric evidence", () => {
  const normalized = normalizeFinalResultTruth(final(null,27,20));
  assert.equal(normalized.result,"W");
  assert.equal(normalized.team_score,27);
  assert.equal(normalized.opponent_score,20);
});

test("FINAL missing scores is unresolved and excluded from record", () => {
  const row = final("W",null,null);
  const evaluated = evaluateFinalResultTruth(row);
  assert.equal(evaluated.state,"UNRESOLVED");
  const record = recordFromScheduleRows([row]);
  assert.deepEqual(record,{wins:0,losses:0,ties:0,conference_wins:0,conference_losses:0,conference_ties:0,scored_finals:0});
});

test("generic parser proves Arkansas winner-first loss regression", () => {
  assert.deepEqual(parseResult("L, 43-10"),{
    status:"FINAL",
    teamScore:10,
    opponentScore:43,
    result:"L"
  });
});

test("duplicate finals count once after normalization", () => {
  const rows = [
    final("L",43,10,{opponent:"Utah",scheduled_at:"2026-09-12T23:00:00.000Z",canonical_event_id:"ce-utah-a"}),
    final("L",10,43,{opponent:"Utah",scheduled_at:"2026-09-12T23:00:00.000Z",canonical_event_id:"ce-utah-b"})
  ];
  const record = recordFromScheduleRows(rows,{reportingSchoolId:"test-school"});
  assert.equal(record.wins,0);
  assert.equal(record.losses,1);
  assert.equal(record.scored_finals,1);
});

test("non-counting finals never enter the record", () => {
  const rows = [
    final("W",28,7,{opponent:"Scrimmage Opponent",notes:"Scrimmage",counts_for_record:0}),
    final("L",43,10,{opponent:"Utah",scheduled_at:"2026-09-12T23:00:00.000Z"})
  ];
  const record = recordFromScheduleRows(rows);
  assert.equal(record.wins,0);
  assert.equal(record.losses,1);
  assert.equal(record.scored_finals,1);
});

test("Arkansas schedule derives 1-1 and renders Utah as L 10-43 despite stale stored 2-0", () => {
  const rows = [
    final("W",31,14,{opponent:"North Alabama",scheduled_at:"2026-09-05T23:00:00.000Z"}),
    final("L",43,10,{opponent:"Utah",scheduled_at:"2026-09-12T23:00:00.000Z"})
  ];
  const truth = evaluateScheduleRecordTruth(rows,{storedRecord:{wins:2,losses:0,ties:0}});
  assert.equal(truth.state,"VERIFIED","normalized individual game truth must remain public truth");
  assert.equal(truth.audit_class,"CONTRADICTORY","stale storage must still be visible to the audit");
  assert.deepEqual(truth.trusted_record,{wins:1,losses:1,ties:0,conference_wins:0,conference_losses:0,conference_ties:0,scored_finals:2});
  assert.ok(truth.issues.some(issue => issue.code === "STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE"));
  const utah = truth.normalized_rows.find(row => row.opponent === "Utah");
  assert.equal(utah.result,"L");
  assert.equal(utah.team_score,10);
  assert.equal(utah.opponent_score,43);
});

test("published record with more completed games marks evidence incomplete", () => {
  const rows = [final("W",31,14)];
  const truth = evaluateScheduleRecordTruth(rows,{publishedRecord:"2-0"});
  assert.equal(truth.state,"INCOMPLETE");
  assert.equal(truth.trusted_record,null);
  assert.ok(truth.issues.some(issue => issue.code === "PUBLISHED_RECORD_EXCEEDS_FINAL_EVIDENCE"));
});

test("published same-game-count contradiction is audited but cannot replace normalized game truth", () => {
  const rows = [
    final("W",31,14,{scheduled_at:"2026-09-05T23:00:00.000Z",opponent:"A"}),
    final("L",10,43,{scheduled_at:"2026-09-12T23:00:00.000Z",opponent:"B"})
  ];
  const truth = evaluateScheduleRecordTruth(rows,{publishedRecord:"2-0"});
  assert.equal(truth.state,"VERIFIED");
  assert.equal(truth.audit_class,"CONTRADICTORY");
  assert.equal(truth.trusted_record.wins,1);
  assert.equal(truth.trusted_record.losses,1);
});

test("fresher normalized evidence wins over a lower stale stored count", () => {
  const rows = [
    final("W",31,14,{scheduled_at:"2026-09-05T23:00:00.000Z",opponent:"A"}),
    final("L",10,43,{scheduled_at:"2026-09-12T23:00:00.000Z",opponent:"B"})
  ];
  const truth = evaluateScheduleRecordTruth(rows,{storedRecord:{wins:1,losses:0,ties:0}});
  assert.equal(truth.state,"VERIFIED");
  assert.deepEqual(truth.trusted_record,{wins:1,losses:1,ties:0,conference_wins:0,conference_losses:0,conference_ties:0,scored_finals:2});
  assert.ok(truth.issues.some(issue => issue.code === "STALE_STORED_RECORD"));
});
