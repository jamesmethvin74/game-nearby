import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRITY_GATE_MAX_PRESENTATION_ISSUES,
  persistIntegrityState,
  runStatewideIntegrityGate
} from "../src/statewide-integrity-gate.js";

function presentationAudit(issues=[]){
  const blocking=issues.filter(issue=>issue.severity==="blocking").length;
  const counts={};
  for(const issue of issues) counts[issue.code]=(counts[issue.code]||0)+1;
  return {
    issues,
    summary:{
      total_active_teams_examined:1227,
      total_schedule_rows_examined:20000,
      total_normalized_schedule_rows:19000,
      teams_with_issues:blocking?1:0,
      blocking_issues:blocking,
      warning_issues:0,
      issues_by_code:counts,
      sports_examined:["football","volleyball"],
      levels_examined:["high-school"]
    },
    d1:{rows_read:100,rows_written:0}
  };
}

test("clean routine gate audits once and persists CLEAN",async()=>{
  let builds=0;
  let suppressed=false;
  const persisted=[];
  const result=await runStatewideIntegrityGate({},{
    reason:"test-clean",
    buildPresentationAudit:async()=>{builds++;return presentationAudit();},
    suppressRoutine:async()=>{suppressed=true;throw new Error("must not suppress");},
    persistState:async(_env,value)=>{persisted.push(value);return {rows_written:1};}
  });
  assert.equal(result.status,"CLEAN");
  assert.equal(builds,1);
  assert.equal(suppressed,false);
  assert.equal(result.repairs.length,0);
  assert.equal(result.record.status,"DEFERRED_TO_RECORD_TRUTH_PIPELINE");
  assert.equal(persisted.length,1);
});

test("safe routine defects are written once and defer verification to the next gate",async()=>{
  const before=presentationAudit([
    {code:"SAME_DAY_STALE_TWIN_OF_FINAL",severity:"blocking",team_id:"nlr-volleyball",game_id:"stale-1"},
    {code:"FOOTBALL_SAME_DAY_COLLISION",severity:"blocking",team_id:"bryant-football",game_id:"stale-2"}
  ]);
  let builds=0;
  let suppressCalls=0;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-repair",
    buildPresentationAudit:async()=>{builds++;return before;},
    suppressRoutine:async(_env,audit)=>{
      suppressCalls++;
      assert.equal(audit,before);
      return {
        status:"EXECUTED",
        issue_count:2,
        issue_counts:{SAME_DAY_STALE_TWIN_OF_FINAL:1,FOOTBALL_SAME_DAY_COLLISION:1},
        suppression:{rows_written:2},
        affected_team_ids:["nlr-volleyball","bryant-football"],
        record_rebuild:{teams:2,scoredFinals:2,standings:{cohorts:1,standingsRows:4}},
        d1:{statements:2,rows_read:4,rows_written:2,duration_ms:1}
      };
    },
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"REPAIRED_PENDING_VERIFY");
  assert.equal(builds,1,"routine gate must not run a second statewide audit in the same Worker invocation");
  assert.equal(suppressCalls,1);
  assert.equal(result.presentation.after.pending_verify,true);
  assert.equal(result.repairs[0].suppressed_rows,2);
});

test("next gate invocation verifies a prior routine repair as CLEAN",async()=>{
  const result=await runStatewideIntegrityGate({},{
    reason:"test-verify",
    buildPresentationAudit:async()=>presentationAudit([]),
    suppressRoutine:async()=>{throw new Error("must not suppress on clean verify");},
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"CLEAN");
  assert.equal(result.presentation.after.blocking_issues,0);
});

test("complex blockers stay blocked instead of being guessed away",async()=>{
  let suppressCalls=0;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-complex",
    buildPresentationAudit:async()=>presentationAudit([
      {code:"DUPLICATE_FINAL_CONTRADICTION",severity:"blocking",team_id:"team-a",game_id:"g1",other_game_id:"g2"}
    ]),
    suppressRoutine:async()=>{suppressCalls++;return {};},
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"BLOCKED");
  assert.equal(suppressCalls,0);
  assert.equal(result.blocker_examples.presentation[0].code,"DUPLICATE_FINAL_CONTRADICTION");
});

test("canonical and missing-score repairs stay out of routine cron writes",async()=>{
  let suppressCalls=0;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-heavy",
    buildPresentationAudit:async()=>presentationAudit([
      {code:"SPLIT_CANONICAL_LOGICAL_GAME",severity:"blocking",team_id:"team-a",game_id:"g1",other_game_id:"g2"},
      {code:"DISPLAY_FINAL_MISSING_SCORE",severity:"blocking",team_id:"team-b",game_id:"g3"}
    ]),
    suppressRoutine:async()=>{suppressCalls++;return {};},
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"BLOCKED");
  assert.equal(suppressCalls,0);
});

test("large safe defect wave trips fuse before writes",async()=>{
  const issues=Array.from({length:INTEGRITY_GATE_MAX_PRESENTATION_ISSUES+1},(_,index)=>({
    code:"PAST_DUE_NONTERMINAL_DISPLAY",
    severity:"blocking",
    team_id:"team-"+index,
    game_id:"game-"+index
  }));
  let suppressCalls=0;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-fuse",
    buildPresentationAudit:async()=>presentationAudit(issues),
    suppressRoutine:async()=>{suppressCalls++;return {};},
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"FUSE_BLOCKED");
  assert.equal(suppressCalls,0);
  assert.deepEqual(result.fuses,["presentation:251>250"]);
});

test("integrity state persistence accepts CLEAN and pending-verify states",async()=>{
  const calls=[];
  const env={DB:{prepare(sql){
    return {bind(...args){
      calls.push({sql,args});
      return {run:async()=>({meta:{rows_read:1,rows_written:1,duration:0.25}})};
    }};
  }}};
  const base={
    generated_at:"2026-09-18T12:00:00.000Z",
    reason:"test",
    presentation:{before:{blocking_issues:0},after:{
      blocking_issues:0,total_schedule_rows_examined:10,total_normalized_schedule_rows:9,total_active_teams_examined:3
    }},
    record:{status:"DEFERRED_TO_RECORD_TRUTH_PIPELINE",after:{blocking_issue_count:null,unexplained_record_contradictions:null}},
    repairs:[],
    fuses:[],
    blocker_examples:{presentation:[],record_contradictions:[],record_gaps:[]}
  };

  const clean=await persistIntegrityState(env,{...base,status:"CLEAN"},base.generated_at);
  assert.equal(clean.rows_written,1);
  const pending=await persistIntegrityState(env,{
    ...base,
    status:"REPAIRED_PENDING_VERIFY",
    presentation:{...base.presentation,after:{...base.presentation.after,blocking_issues:2,pending_verify:true}}
  },base.generated_at);
  assert.equal(pending.rows_written,1);
  assert.equal(calls.length,2);
  assert.equal(calls[0].args.length,9);
  assert.equal(calls[1].args.length,9);
  assert.match(calls[1].args[6],/pending_verify=1/);
});


test("standings readiness blockers make the scheduled integrity state BLOCKED",async()=>{
  const result=await runStatewideIntegrityGate({},{
    reason:"morning-results",
    auditStandings:true,
    buildPresentationAudit:async()=>presentationAudit([]),
    buildStandingsAudit:async()=>({
      status:"BLOCKED",
      summary:{conferences_examined:12,blocking_issues:1,warning_issues:3,issues_by_code:{STANDINGS_EMPTY:1}},
      issues:[{code:"STANDINGS_EMPTY",severity:"blocking",sport:"football",conference_id:"5a-east"}],
      checked:[]
    }),
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"BLOCKED");
  assert.equal(result.standings.summary.blocking_issues,1);
  assert.equal(result.blocker_examples.standings[0].code,"STANDINGS_EMPTY");
});

test("standings readiness warnings do not dirty a factual published fallback",async()=>{
  const result=await runStatewideIntegrityGate({},{
    reason:"morning-results",
    auditStandings:true,
    buildPresentationAudit:async()=>presentationAudit([]),
    buildStandingsAudit:async()=>({
      status:"READY",
      summary:{conferences_examined:12,blocking_issues:0,warning_issues:4,issues_by_code:{STANDINGS_USING_PUBLISHED_FALLBACK:4}},
      issues:[{code:"STANDINGS_USING_PUBLISHED_FALLBACK",severity:"warning",sport:"football",conference_id:"7a-west"}],
      checked:[]
    }),
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"CLEAN");
  assert.equal(result.standings.summary.warning_issues,4);
});
