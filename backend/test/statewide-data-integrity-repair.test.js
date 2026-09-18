import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalRepairClusters,
  buildStatewideRepairPlan,
  buildAuditedCanonicalMergePlan,
  chooseCanonicalWinner,
  reconcileAuditedCanonicalDefects
} from "../src/statewide-data-integrity-repair.js";

function issue(code,{team="team-a",game="g1",other=null,severity="blocking"}={}) {
  return {code,severity,team_id:team,game_id:game,other_game_id:other};
}

test("repair plan includes only blocking M15 classes and batches sources at the Worker limit",()=>{
  const audit={issues:[
    issue("PAST_DUE_NONTERMINAL_DISPLAY",{team:"team-a",game:"g1"}),
    issue("PAST_DUE_NONTERMINAL_DISPLAY",{team:"team-b",game:"g2",severity:"warning"}),
    issue("DISPLAY_FINAL_SOURCE_QUARANTINED",{team:"team-c",game:"g3",severity:"warning"}),
    issue("DISPLAY_FINAL_MISSING_SCORE",{team:"team-d",game:"g4"})
  ]};
  const sources=Array.from({length:18},(_,index)=>({id:`src-${index}`,team_id:index<17?"team-a":"team-d"}));
  const plan=buildStatewideRepairPlan(audit,sources);
  assert.deepEqual(plan.affectedTeamIds.sort(),["team-a","team-d"]);
  assert.equal(plan.issueCounts.PAST_DUE_NONTERMINAL_DISPLAY,1);
  assert.equal(plan.issueCounts.DISPLAY_FINAL_MISSING_SCORE,1);
  assert.equal(plan.sourceIds.length,18);
  assert.deepEqual(plan.sourceBatches.map(batch=>batch.length),[16,2]);
});

test("canonical repair clusters collapse overlapping audit pairs without inventing new pairs",()=>{
  const audit={issues:[
    issue("SPLIT_CANONICAL_LOGICAL_GAME",{game:"g1",other:"g2"}),
    issue("STALE_NONTERMINAL_TWIN_OF_FINAL",{game:"g2",other:"g1"}),
    issue("DUPLICATE_SCHEDULE_ENTRY",{game:"g2",other:"g3"}),
    issue("PAST_DUE_NONTERMINAL_DISPLAY",{game:"g4"})
  ]};
  const clusters=buildCanonicalRepairClusters(audit);
  assert.equal(clusters.length,1);
  assert.deepEqual(clusters[0].gameIds.sort(),["g1","g2","g3"]);
  assert.deepEqual(clusters[0].codes,["DUPLICATE_SCHEDULE_ENTRY","SPLIT_CANONICAL_LOGICAL_GAME","STALE_NONTERMINAL_TWIN_OF_FINAL"]);
});

test("canonical repair retries only audit-proven cluster members and rebuilds both participating teams once",async()=>{
  const audit={issues:[
    issue("SPLIT_CANONICAL_LOGICAL_GAME",{team:"team-a",game:"g1",other:"g2"}),
    issue("STALE_NONTERMINAL_TWIN_OF_FINAL",{team:"team-a",game:"g1",other:"g2"})
  ]};
  const calls=[];
  const rebuilds=[];
  const loaded=[];
  const reconcile=async(_env,gameId)=>{
    calls.push(gameId);
    return gameId==="g2"?"ce-fixed":null;
  };
  const loadAffectedTeams=async(_env,gameIds)=>{
    loaded.push([...gameIds]);
    return ["team-a","team-b"];
  };
  const rebuildRecords=async(_env,teamIds)=>{
    rebuilds.push(teamIds);
    return {teams:teamIds.length,scoredFinals:1,standings:{cohorts:1,standingsRows:2}};
  };
  const result=await reconcileAuditedCanonicalDefects({},audit,{reconcile,rebuildRecords,loadAffectedTeams});
  assert.deepEqual(calls,["g1","g2"]);
  assert.equal(result.clustersRepaired,1);
  assert.deepEqual(loaded,[["g1","g2"]]);
  assert.deepEqual(result.affectedTeamIds,["team-a","team-b"]);
  assert.deepEqual(rebuilds,[["team-a","team-b"]]);
  assert.equal(result.recordRebuild.standings.cohorts,1);
});

test("failed canonical clusters do not cause unrelated record rebuilds",async()=>{
  const audit={issues:[issue("DUPLICATE_SCHEDULE_ENTRY",{team:"team-a",game:"g1",other:"g2"})]};
  let loaderCalled=false;
  let rebuildCalled=false;
  const result=await reconcileAuditedCanonicalDefects({},audit,{
    reconcile:async()=>null,
    loadAffectedTeams:async()=>{loaderCalled=true;return ["team-a","team-b"];},
    rebuildRecords:async()=>{rebuildCalled=true;return {};}
  });
  assert.equal(result.clustersRepaired,0);
  assert.equal(loaderCalled,false);
  assert.equal(rebuildCalled,false);
  assert.deepEqual(result.affectedTeamIds,[]);
});


test("canonical merge winner prefers complete final truth over enabled stale schedule",()=>{
  const rows=[
    {game_id:"scheduled",canonical_event_id:"ce-scheduled",canonical_status:"SCHEDULED",source_enabled:1,authority_rank:5},
    {game_id:"final",canonical_event_id:"ce-final",canonical_status:"FINAL",canonical_home_score:28,canonical_away_score:14,source_enabled:0,authority_rank:10}
  ];
  assert.equal(chooseCanonicalWinner(rows),"ce-final");
});

test("audit-proven split plan merges only cluster canonical IDs and can promote one unambiguous raw final",()=>{
  const audit={issues:[
    issue("SPLIT_CANONICAL_LOGICAL_GAME",{team:"home-team",game:"g-scheduled",other:"g-final"}),
    issue("STALE_NONTERMINAL_TWIN_OF_FINAL",{team:"home-team",game:"g-scheduled",other:"g-final"})
  ]};
  const rows=[
    {
      game_id:"g-scheduled",canonical_event_id:"ce-old",canonical_status:"SCHEDULED",
      canonical_home_school_id:"home",canonical_away_school_id:"away",
      reporting_school_id:"home",raw_status:"SCHEDULED",source_enabled:1,authority_rank:10
    },
    {
      game_id:"g-final",canonical_event_id:"ce-new",canonical_status:"SCHEDULED",
      canonical_home_school_id:"home",canonical_away_school_id:"away",
      reporting_school_id:"away",raw_status:"FINAL",raw_team_score:14,raw_opponent_score:28,
      source_enabled:0,authority_rank:20
    }
  ];
  const plan=buildAuditedCanonicalMergePlan(audit,rows);
  assert.equal(plan.length,1);
  assert.deepEqual(plan[0].game_ids.sort(),["g-final","g-scheduled"]);
  assert.equal(plan[0].loser_canonical_ids.length,1);
  assert.deepEqual(plan[0].promote_final,{home_score:28,away_score:14});
});

test("ambiguous raw final evidence is never promoted",()=>{
  const audit={issues:[issue("SPLIT_CANONICAL_LOGICAL_GAME",{game:"g1",other:"g2"})]};
  const common={
    canonical_event_id:"ce-a",canonical_status:"SCHEDULED",
    canonical_home_school_id:"home",canonical_away_school_id:"away",
    reporting_school_id:"home",source_enabled:1,authority_rank:10
  };
  const rows=[
    {...common,game_id:"g1",raw_status:"FINAL",raw_team_score:21,raw_opponent_score:14},
    {...common,game_id:"g2",raw_status:"FINAL",raw_team_score:28,raw_opponent_score:14}
  ];
  const plan=buildAuditedCanonicalMergePlan(audit,rows);
  assert.equal(plan.length,1);
  assert.equal(plan[0].promote_final,null);
});
