import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_VERSION,
  filterScheduleResponse,
  reconcileRetiredScheduleTruth
} from "../src/coverage-report-worker-v6.js";
import { DRAGONFLY_STATEWIDE_REMOVED_NOTE } from "../src/current-schedule-truth.js";

function teamFixture() {
  return {
    team_id:"df-ezw3f9-boys-basketball-2026",
    school_id:"df-ezw3f9",
    school_name:"Marion High School",
    level:"high-school",
    sport:"basketball",
    gender:"boys",
    coverage_scope:"supported",
    expected_target:true,
    backend_team_present:true,
    backend_team_active:true,
    conference_status:"Unverified",
    schedule_status:"Partial",
    schedule_basis:"source_snapshot_storage_mismatch",
    results_status:"Unverified",
    records_status:"Unverified",
    standings_status:"Unverified",
    audit_source_id:"df-ezw3f9-boys-basketball-2026-dragonfly-statewide",
    audit_source_type:"official-conference",
    audit_source_enabled:false,
    audit_source_collection_mode:"statewide",
    audit_source_snapshot_count:20,
    audit_source_game_count:21,
    game_count:21,
    result_due_count:0,
    resolved_result_count:0,
    unresolved_due_count:0,
    final_missing_score_count:0,
    stored_record:{wins:0,losses:0,ties:0},
    derived_record:{wins:0,losses:0,ties:0},
    issues:[
      {code:"schedule_snapshot_storage_mismatch",category:"schedule",detail:"20 vs 21"},
      {code:"conference_membership_unverified",category:"standings",detail:"No conference attached."}
    ]
  };
}

function reportFixture() {
  const team=teamFixture();
  return {
    audit_contract:{version:"truthful-coverage-v5"},
    inventory:{total_expected_teams:1232},
    d1:{rows_read:100,rows_written:0,duration_ms:5},
    teams:[team],
    schools:[{school_id:team.school_id,teams:[team]}],
    exceptions:[],
    production_only_exceptions:[],
    summary:{}
  };
}

test("v6 reconciles exact retained statewide lineage without deleting D1 rows", async () => {
  assert.equal(AUDIT_VERSION,"truthful-coverage-v6");
  let prepares=0;
  const report=reportFixture();
  const env={
    DB:{
      prepare(sql) {
        prepares += 1;
        assert.match(sql,/GROUP BY source_id/);
        assert.match(sql,/json_each/);
        return {
          bind(marker,sourceIdsJson) {
            assert.equal(marker,DRAGONFLY_STATEWIDE_REMOVED_NOTE);
            assert.deepEqual(JSON.parse(sourceIdsJson),["df-ezw3f9-boys-basketball-2026-dragonfly-statewide"]);
            return {
              async all() {
                return {
                  results:[{
                    source_id:"df-ezw3f9-boys-basketball-2026-dragonfly-statewide",
                    total_count:21,
                    retired_count:1
                  }],
                  meta:{rows_read:21,rows_written:0,duration:1}
                };
              }
            };
          }
        };
      }
    }
  };

  await reconcileRetiredScheduleTruth(env,report);
  const team=report.teams[0];
  assert.equal(prepares,1,"retained lineage must be reconciled with one set-based query, never N+1");
  assert.equal(team.audit_source_snapshot_count,20);
  assert.equal(team.audit_source_game_count,20);
  assert.equal(team.audit_source_retired_game_count,1);
  assert.equal(team.game_count,20);
  assert.equal(team.schedule_status,"Complete");
  assert.equal(team.results_status,"Complete");
  assert.equal(team.records_status,"Complete");
  assert.equal(team.schedule_basis,"fresh_source_snapshot_exact_match_after_retired_lineage_filter");
  assert.ok(!team.issues.some(issue=>issue.code==="schedule_snapshot_storage_mismatch"));
  assert.ok(team.issues.some(issue=>issue.code==="retired_schedule_lineage_retained" && issue.informational===true));
  assert.equal(report.summary.retired_schedule_reconciliation.corrected,1);
  assert.equal(report.summary.retired_schedule_reconciliation.retained_rows,1);
  assert.equal(report.summary.exception_counts.schedule_snapshot_storage_mismatch,undefined);
  assert.equal(report.summary.exception_counts.conference_membership_unverified,1);
  assert.equal(report.d1.rows_read,121);
  assert.equal(report.d1.rows_written,0);
});

test("v6 refuses to hide a real storage mismatch when retired rows do not explain it", async () => {
  const report=reportFixture();
  const env={DB:{prepare(){return {bind(){return {async all(){return {
    results:[{source_id:"df-ezw3f9-boys-basketball-2026-dragonfly-statewide",total_count:22,retired_count:1}],
    meta:{rows_read:22,rows_written:0,duration:1}
  };}};}};}}};
  await reconcileRetiredScheduleTruth(env,report);
  const team=report.teams[0];
  assert.equal(team.schedule_status,"Partial");
  assert.ok(team.issues.some(issue=>issue.code==="schedule_snapshot_storage_mismatch"));
  assert.equal(report.summary.retired_schedule_reconciliation.corrected,0);
});

test("public schedule filtering removes only explicit retained-lineage rows", async () => {
  const request=new Request("https://example.test/api/v1/schools/df-ezw3f9/schedule");
  const response=new Response(JSON.stringify({games:[
    {id:"real-cancel",status:"CANCELED",notes:"Canceled by school"},
    {id:"retired",status:"CANCELED",notes:DRAGONFLY_STATEWIDE_REMOVED_NOTE},
    {id:"scheduled",status:"SCHEDULED",notes:null}
  ]}),{status:200,headers:{"content-type":"application/json"}});
  const filtered=await filterScheduleResponse(request,response);
  const body=await filtered.json();
  assert.deepEqual(body.games.map(game=>game.id),["real-cancel","scheduled"]);
  assert.equal(filtered.headers.get("x-localbleachers-retired-schedule-rows-hidden"),"1");
});
