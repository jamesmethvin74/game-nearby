import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRITY_GATE_MAX_PRESENTATION_ISSUES,
  persistIntegrityState,
  recordMaterializationRepairTeamIds,
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
      sports_examined:["football"],
      levels_examined:["high-school"]
    },
    d1:{rows_read:100,rows_written:0}
  };
}

function recordAudit(teams=[]){
  return {
    teams,
    summary:{
      unexplained_record_contradictions:0,
      non_verified:teams.filter(team=>team.classification!=="VERIFIED").length
    }
  };
}

test("clean gate performs no repairs and persists CLEAN",async()=>{
  const persisted=[];
  let presentationBuilds=0;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-clean",
    buildPresentationAudit:async()=>{presentationBuilds++;return presentationAudit();},
    buildRecordAudit:async()=>recordAudit([]),
    finalizeRecordAudit:value=>value,
    repairPresentation:async()=>{throw new Error("repair should not run");},
    rebuildRecords:async()=>{throw new Error("record rebuild should not run");},
    persistState:async(_env,value)=>{persisted.push(value);return {rows_written:1};}
  });
  assert.equal(result.status,"CLEAN");
  assert.equal(presentationBuilds,1);
  assert.equal(result.repairs.length,0);
  assert.equal(result.record.rebuild.teams,0);
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].status,"CLEAN");
});

test("repairable presentation defects are repaired before verified record materialization drift",async()=>{
  const before=presentationAudit([{
    code:"PAST_DUE_NONTERMINAL_DISPLAY",severity:"blocking",team_id:"team-a",game_id:"g1"
  }]);
  const after=presentationAudit([]);
  let repaired=0;
  let rebuilt=[];
  let recordBuilds=0;
  const staleTeam={
    team_id:"team-a",
    school_name:"Alpha",
    sport:"football",
    gender:"boys",
    classification:"VERIFIED",
    public_record_verified:true,
    issues:[{code:"STALE_RECORD_ROW",severity:"info",resolved:true}]
  };
  const result=await runStatewideIntegrityGate({},{
    reason:"test-repair",
    buildPresentationAudit:async()=>before,
    repairPresentation:async()=>{repaired++;return {
      before_blocking:1,
      canonical:{clusters:0,canonical_merges:0,game_reassignments:0,final_promotions:0},
      score_repair:{promoted:[]},
      suppression:{rows_written:1},
      affected_team_ids:["team-a"],
      record_rebuild:{teams:1,scoredFinals:1,standings:{cohorts:1,standingsRows:2}},
      after_summary:after.summary,
      after_audit:after,
      d1:{rows_read:10,rows_written:1}
    };},
    buildRecordAudit:async()=>{
      recordBuilds++;
      return recordBuilds===1?recordAudit([staleTeam]):recordAudit([{
        ...staleTeam,issues:[]
      }]);
    },
    finalizeRecordAudit:value=>value,
    rebuildRecords:async(_env,ids)=>{
      rebuilt=[...ids];
      return {teams:ids.length,scoredFinals:1,standings:{cohorts:1,standingsRows:2}};
    },
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"CLEAN");
  assert.equal(repaired,1);
  assert.deepEqual(rebuilt,["team-a"]);
  assert.equal(result.repairs.length,1);
  assert.equal(result.record.rebuild.teams,1);
});

test("unrepairable contradictory final stays blocking instead of being guessed away",async()=>{
  let repaired=false;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-contradiction",
    buildPresentationAudit:async()=>presentationAudit([{
      code:"DUPLICATE_FINAL_CONTRADICTION",severity:"blocking",team_id:"team-a",game_id:"g1",other_game_id:"g2"
    }]),
    repairPresentation:async()=>{repaired=true;throw new Error("must not repair contradiction");},
    buildRecordAudit:async()=>recordAudit([]),
    finalizeRecordAudit:value=>value,
    persistState:async()=>({rows_written:1})
  });
  assert.equal(repaired,false);
  assert.equal(result.status,"BLOCKED");
  assert.equal(result.presentation.after.blocking_issues,1);
  assert.equal(result.blocker_examples.presentation[0].code,"DUPLICATE_FINAL_CONTRADICTION");
});

test("large presentation defect wave trips fuse before writes",async()=>{
  const issues=Array.from({length:INTEGRITY_GATE_MAX_PRESENTATION_ISSUES+1},(_,index)=>({
    code:"PAST_DUE_NONTERMINAL_DISPLAY",
    severity:"blocking",
    team_id:"team-"+index,
    game_id:"game-"+index
  }));
  let repaired=false;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-fuse",
    buildPresentationAudit:async()=>presentationAudit(issues),
    repairPresentation:async()=>{repaired=true;throw new Error("fuse failed");},
    buildRecordAudit:async()=>recordAudit([]),
    finalizeRecordAudit:value=>value,
    persistState:async()=>({rows_written:1})
  });
  assert.equal(repaired,false);
  assert.equal(result.status,"FUSE_BLOCKED");
  assert.deepEqual(result.fuses,["presentation:251>250"]);
});

test("record materialization repair targets only verified drift",()=>{
  const ids=recordMaterializationRepairTeamIds(recordAudit([
    {
      team_id:"verified-stale",public_record_verified:true,
      issues:[{code:"STALE_RECORD_ROW",severity:"info",resolved:true}]
    },
    {
      team_id:"verified-standing",public_record_verified:true,
      issues:[{code:"MATERIALIZED_STANDING_RECORD_CONTRADICTION",severity:"blocking",resolved:false}]
    },
    {
      team_id:"unverified-stale",public_record_verified:false,
      issues:[{code:"STALE_RECORD_ROW",severity:"info",resolved:true}]
    },
    {
      team_id:"published-conflict",public_record_verified:true,
      issues:[{code:"PUBLISHED_RECORD_CONTRADICTS_FINAL_EVIDENCE",severity:"blocking",resolved:false}]
    }
  ]));
  assert.deepEqual(ids.sort(),["verified-stale","verified-standing"]);
});

test("integrity state persistence uses one bounded status upsert",async()=>{
  let boundArgs=null;
  let sqlText="";
  const env={DB:{prepare(sql){
    sqlText=sql;
    return {bind(...args){
      boundArgs=args;
      return {run:async()=>({meta:{rows_read:1,rows_written:1,duration:0.25}})};
    }};
  }}};
  const result={
    status:"CLEAN",
    generated_at:"2026-09-18T12:00:00.000Z",
    reason:"test",
    presentation:{before:{blocking_issues:0},after:{
      blocking_issues:0,total_schedule_rows_examined:10,total_normalized_schedule_rows:9,total_active_teams_examined:3
    }},
    record:{after:{blocking_issue_count:0,unexplained_record_contradictions:0}},
    repairs:[],
    fuses:[],
    blocker_examples:{presentation:[],record:[]}
  };
  const meta=await persistIntegrityState(env,result,result.generated_at);
  assert.match(sqlText,/INSERT INTO statewide_collection_state/);
  assert.equal(boundArgs.length,9);
  assert.equal(meta.rows_written,1);
});


test("fail-closed record evidence gaps do not make visible presentation truth dirty",async()=>{
  const gapAudit=recordAudit([{
    team_id:"gap-team",
    classification:"INCOMPLETE",
    public_record_verified:false,
    issues:[{
      code:"STORED_CONFERENCE_RECORD_EXCEEDS_FINAL_EVIDENCE",
      severity:"blocking",
      resolved:false,
      detail:"stored conference record is ahead of final evidence"
    }]
  }]);
  const result=await runStatewideIntegrityGate({},{
    reason:"test-gap",
    buildPresentationAudit:async()=>presentationAudit([]),
    buildRecordAudit:async()=>gapAudit,
    finalizeRecordAudit:value=>value,
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"CLEAN");
  assert.equal(result.record.after.audit_blocking_gap_count,1);
  assert.equal(result.record.after.unexplained_record_contradictions,0);
});

test("unexplained record contradiction blocks a clean presentation gate",async()=>{
  const contradiction=recordAudit([{
    team_id:"bad-record",
    school_name:"Bad Record High",
    sport:"football",
    gender:"boys",
    classification:"CONTRADICTORY",
    public_record_verified:true,
    issues:[{
      code:"PUBLISHED_RECORD_CONTRADICTS_FINAL_EVIDENCE",
      severity:"warning",
      resolved:false,
      detail:"published record disagrees with final evidence"
    }]
  }]);
  contradiction.summary.unexplained_record_contradictions=1;
  const result=await runStatewideIntegrityGate({},{
    reason:"test-record-contradiction",
    buildPresentationAudit:async()=>presentationAudit([]),
    buildRecordAudit:async()=>contradiction,
    finalizeRecordAudit:value=>value,
    persistState:async()=>({rows_written:1})
  });
  assert.equal(result.status,"BLOCKED");
  assert.equal(result.record.after.unexplained_record_contradictions,1);
  assert.equal(result.blocker_examples.record_contradictions[0].team_id,"bad-record");
});
