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
  assert.equal(audit.summary.unexplained_record_contradictions,1);
});

test("orientation-corrected stale storage remains explained", () => {
  const team={
    team_id:"uark-football-2026",
    classification:"CONTRADICTORY",
    orientation_corrections:1,
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
  assert.equal(audit.summary.unexplained_record_contradictions,0);
});

test("unexplained stale storage without newer evidence blocks zero-contradiction gate", () => {
  const team={
    team_id:"sample-basketball-2026",
    classification:"CONTRADICTORY",
    orientation_corrections:0,
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
  assert.equal(audit.summary.unexplained_record_contradictions,1);
});

test("protected M8 endpoint applies finalizer before returning statewide record truth", async () => {
  const source=await readFile(new URL("../src/m8-worker.js",import.meta.url),"utf8");
  assert.match(source,/finalizeRecordTruthAudit\(await buildStatewideRecordTruthAudit/);
  assert.match(source,/authorizedAudit\(request,env\)/);
  assert.match(source,/x-refresh-token/);
  assert.match(source,/cache-control\":\"no-store/);
});
