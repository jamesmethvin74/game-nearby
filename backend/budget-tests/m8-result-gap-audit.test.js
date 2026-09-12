import test from "node:test";
import assert from "node:assert/strict";
import { buildResultGapAudit } from "../src/result-gap-audit.js";

function team(overrides = {}) {
  return {
    team_id:"conway-volleyball-2026",
    school_id:"conway",
    school_name:"Conway High School",
    level:"high-school",
    sport:"volleyball",
    gender:"girls",
    season:"2026",
    coverage_scope:"supported",
    backend_team_present:true,
    schedule_status:"Complete",
    results_status:"Complete",
    records_status:"Complete",
    audit_source_id:"conway-volleyball-2026-dragonfly-statewide",
    audit_source_type:"official-conference",
    result_due_count:5,
    resolved_result_count:5,
    unresolved_due_count:0,
    final_missing_score_count:0,
    issues:[],
    ...overrides
  };
}

test("M8 groups unresolved result truth without inventing extra D1 work", () => {
  const report = {
    generated_at:"2026-09-12T20:00:00.000Z",
    audit_contract:{version:"truthful-coverage-v6"},
    d1:{rows_read:1234,rows_written:0},
    teams:[
      team(),
      team({
        team_id:"greenbrier-volleyball-2026",
        school_id:"greenbrier",
        school_name:"Greenbrier High School",
        results_status:"Partial",
        result_due_count:8,
        resolved_result_count:6,
        unresolved_due_count:2,
        final_missing_score_count:1,
        issues:[
          {code:"missing_past_results",category:"results",count:2},
          {code:"final_missing_score",category:"results",count:1}
        ]
      }),
      team({
        team_id:"df-basketball-boys-2026",
        school_id:"df-basketball",
        school_name:"Example Basketball High School",
        sport:"basketball",
        gender:"boys",
        schedule_status:"Unverified",
        results_status:"Unverified",
        audit_source_id:"df-basketball-boys-2026-dragonfly-statewide",
        unresolved_due_count:0,
        issues:[{code:"schedule_source_stale",category:"schedule"}]
      }),
      team({
        team_id:"college-football-boys-2026",
        school_id:"college",
        school_name:"Example College",
        level:"college",
        sport:"football",
        schedule_status:"Missing",
        results_status:"Missing",
        audit_source_id:null,
        source_resolution:"blocked",
        issues:[{code:"college_source_blocked",category:"source"}]
      }),
      team({
        team_id:"soccer-boys-2026",
        school_id:"soccer",
        school_name:"Example Soccer High School",
        sport:"soccer",
        gender:"boys",
        results_status:"Complete",
        records_status:"Mismatch",
        issues:[{code:"record_vs_final_mismatch",category:"record"}]
      }),
      team({
        team_id:"production-only-football",
        coverage_scope:"production-only",
        sport:"football",
        results_status:"Partial",
        unresolved_due_count:9
      })
    ]
  };

  const audit = buildResultGapAudit(report);
  assert.equal(audit.audit_contract.version,"m8-result-gaps-v1");
  assert.deepEqual(audit.d1,report.d1,"classifier must only report upstream D1 telemetry");
  assert.equal(audit.summary.supported_teams,5);
  assert.equal(audit.summary.result_gap_teams,4);
  assert.equal(audit.summary.due_gap_teams,1);
  assert.equal(audit.summary.unresolved_due_contests,2);
  assert.equal(audit.summary.final_missing_score_contests,1);
  assert.equal(audit.summary.result_coverage_unverified_teams,2);
  assert.equal(audit.summary.record_truth_mismatch_teams,1);
  assert.ok(!audit.work_items.some(item=>item.team_id==="production-only-football"));
  assert.ok(!audit.work_items.some(item=>item.team_id==="conway-volleyball-2026"));

  const greenbrier = audit.work_items.find(item=>item.team_id==="greenbrier-volleyball-2026");
  assert.deepEqual(greenbrier.exception_types,["past_due_unresolved","final_missing_score"]);
  assert.equal(greenbrier.source_provider,"dragonfly");
  assert.equal(greenbrier.authority_state,"available");

  const college = audit.work_items.find(item=>item.team_id==="college-football-boys-2026");
  assert.equal(college.authority_state,"blocked");

  assert.equal(audit.grouped.by_exception_type.find(row=>row.value==="past_due_unresolved").teams,1);
  assert.equal(audit.grouped.by_sport.find(row=>row.value==="volleyball").teams,1);
  assert.equal(audit.grouped.by_sport.find(row=>row.value==="football").teams,1);
});

test("M8 marks deterministic identity ambiguity as a blocking state", () => {
  const report = {
    audit_contract:{version:"truthful-coverage-v6"},
    teams:[team({
      team_id:"ambiguous-volleyball-2026",
      school_id:"ambiguous",
      school_name:"Ambiguous High School",
      results_status:"Partial",
      unresolved_due_count:1,
      issues:[
        {code:"missing_past_results",category:"results",count:1},
        {code:"ambiguous_school_identity",category:"identity"}
      ]
    })]
  };
  const audit = buildResultGapAudit(report);
  assert.equal(audit.summary.identity_blocked_teams,1);
  assert.equal(audit.work_items[0].authority_state,"identity-blocked");
  assert.ok(audit.work_items[0].exception_types.includes("identity_blocker"));
});
