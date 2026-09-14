import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { finalizeRecordTruthAudit } from "../src/record-truth-audit-output.js";

function auditFor(team) {
  return {
    audit_contract:{version:"record-truth-v1"},
    summary:{unexplained_record_contradictions:0,non_verified:1},
    non_verified_teams:[team],
    teams:[team]
  };
}

test("published contradiction remains unexplained in merge-gate summary", () => {
  const team={
    team_id:"sample-football-2026",
    classification:"CONTRADICTORY",
    orientation_corrections:0,
    unexplained_issue_count:0,
    issues:[{
      code:"PUBLISHED_RECORD_CONTRADICTS_FINAL_EVIDENCE",
      severity:"info",
      resolved:true
    }]
  };
  const audit=finalizeRecordTruthAudit(auditFor(team));
  assert.equal(team.issues[0].severity,"warning");
  assert.equal(team.issues[0].resolved,false);
  assert.equal(team.unexplained_issue_count,1);
  assert.equal(team.unexplained_contradiction_count,1);
  assert.equal(audit.summary.unexplained_record_contradictions,1);
});

test("orientation-corrected stale storage remains explained", () => {
  const team={
    team_id:"uark-football-2026",
    classification:"CONTRADICTORY",
    public_record_verified:true,
    orientation_corrections:1,
    evidence_games:2,
    stored_record:{wins:2,losses:0,ties:0},
    trusted_record:{wins:1,losses:1,ties:0},
    unexplained_issue_count:1,
    issues:[{
      code:"STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE",
      severity:"warning",
      resolved:false
    }]
  };
  const audit=finalizeRecordTruthAudit(auditFor(team));
  assert.equal(team.issues[0].severity,"info");
  assert.equal(team.issues[0].resolved,true);
  assert.equal(team.unexplained_issue_count,0);
  assert.equal(team.unexplained_contradiction_count,0);
  assert.equal(audit.summary.unexplained_record_contradictions,0);
});

test("verified normalized evidence ahead of stored count is explained stale materialization", () => {
  const team={
    team_id:"cbc-volleyball-women-2026",
    classification:"CONTRADICTORY",
    public_record_verified:true,
    orientation_corrections:0,
    evidence_games:11,
    stored_record:{wins:1,losses:9,ties:0},
    trusted_record:{wins:2,losses:9,ties:0},
    unexplained_issue_count:1,
    issues:[{
      code:"STALE_STORED_RECORD",
      severity:"warning",
      resolved:false
    }]
  };
  const audit=finalizeRecordTruthAudit(auditFor(team));
  assert.equal(team.issues[0].severity,"info");
  assert.equal(team.issues[0].resolved,true);
  assert.equal(team.unexplained_issue_count,0);
  assert.equal(team.unexplained_contradiction_count,0);
  assert.equal(audit.summary.unexplained_record_contradictions,0);
});

test("lower-count storage without a complete trusted record still blocks the gate", () => {
  const team={
    team_id:"sample-volleyball-2026",
    classification:"CONTRADICTORY",
    public_record_verified:false,
    orientation_corrections:0,
    evidence_games:11,
    stored_record:{wins:1,losses:9,ties:0},
    trusted_record:null,
    unexplained_issue_count:0,
    issues:[{
      code:"STALE_STORED_RECORD",
      severity:"info",
      resolved:true
    }]
  };
  const audit=finalizeRecordTruthAudit(auditFor(team));
  assert.equal(team.issues[0].severity,"warning");
  assert.equal(team.issues[0].resolved,false);
  assert.equal(team.unexplained_contradiction_count,1);
  assert.equal(audit.summary.unexplained_record_contradictions,1);
});

test("unexplained stale same-count storage without newer evidence blocks zero-contradiction gate", () => {
  const team={
    team_id:"sample-basketball-2026",
    classification:"CONTRADICTORY",
    public_record_verified:true,
    orientation_corrections:0,
    evidence_games:2,
    stored_record:{wins:2,losses:0,ties:0},
    trusted_record:{wins:1,losses:1,ties:0},
    unexplained_issue_count:0,
    issues:[{
      code:"STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE",
      severity:"info",
      resolved:true
    }]
  };
  const audit=finalizeRecordTruthAudit(auditFor(team));
  assert.equal(team.issues[0].severity,"warning");
  assert.equal(team.issues[0].resolved,false);
  assert.equal(team.unexplained_contradiction_count,1);
  assert.equal(audit.summary.unexplained_record_contradictions,1);
});

test("an INCOMPLETE team cannot hide a blocking result contradiction from the gate", () => {
  const team={
    team_id:"incomplete-with-conflict-2026",
    classification:"INCOMPLETE",
    public_record_verified:false,
    orientation_corrections:0,
    evidence_games:1,
    stored_record:{wins:2,losses:0,ties:0},
    trusted_record:null,
    unexplained_issue_count:2,
    issues:[
      {code:"STORED_RECORD_EXCEEDS_FINAL_EVIDENCE",severity:"blocking",resolved:false},
      {code:"SAME_GAME_SOURCE_CONTRADICTION",severity:"blocking",resolved:false}
    ]
  };
  const audit=finalizeRecordTruthAudit(auditFor(team));
  assert.equal(team.classification,"INCOMPLETE");
  assert.equal(team.unexplained_contradiction_count,1);
  assert.equal(audit.summary.unexplained_record_contradictions,1);
});

test("protected M8 endpoint applies finalizer before returning statewide record truth", async () => {
  const source=await readFile(new URL("../src/m8-worker.js",import.meta.url),"utf8");
  assert.match(source,/finalizeRecordTruthAudit\(await buildStatewideRecordTruthAudit/);
  assert.match(source,/authorizedAudit\(request,env\)/);
  assert.match(source,/x-refresh-token/);
  assert.match(source,/cache-control\":\"no-store/);
});
