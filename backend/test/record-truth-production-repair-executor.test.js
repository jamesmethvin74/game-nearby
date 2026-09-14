import test from "node:test";
import assert from "node:assert/strict";

import { classifyRecordTruthRepairState } from "../src/record-truth-production-repair.js";

const BE="ce:volleyball:girls:2026:df-hrdb8f:df-jufft8:20260824:t1630";
const LA="ce:volleyball:girls:2026:df-hrdb8f:df-vt4unv:20260827:df-695c0750c5e8bf402b000008";
const H1="ce:volleyball:girls:2026:df-ht8yyh:df-sz3b5e:20260829:mp-350185fc-ef8a-471b-a26e-1c9f04dfc231";
const H2="ce:volleyball:girls:2026:df-ht8yyh:df-sz3b5e:20260829:mp-3fa66510-5b2b-47c8-b51a-642679c44b6a";
const BSS="mp-xe6tf6lf7uco1soenbisnw-7a263f82";
const C1=`ce:volleyball:girls:2026:df-kq5hlr:${BSS}:20260829:mp-441a726d-4c94-4d68-bae8-4101f7d54446`;
const C2=`ce:volleyball:girls:2026:df-kq5hlr:${BSS}:20260829:mp-df6a4eed-d762-4c70-abe3-624fd7452bcc`;

function canonical(id,home,away,homeScore,awayScore,extra={}){
  const participants=[home,away].sort();
  return {id,participant_a_school_id:participants[0],participant_b_school_id:participants[1],home_school_id:home,away_school_id:away,status:"FINAL",home_score:homeScore,away_score:awayScore,selected_source_id:"source",trust_state:"CORROBORATED",conflict_count:0,...extra};
}
function game({id,school,opponent,parser,event,status="FINAL",teamScore,opponentScore,result,canonicalId,counts=1,source="source"}){
  return {game_id:id,team_id:`${school}-team`,reporting_school_id:school,opponent_school_id:opponent,source_id:source,parser_type:parser,authority_rank:10,source_event_key:event,scheduled_at:"2026-08-29T17:00:00.000Z",scheduled_time_known:0,home_away:"home",conference_game:0,counts_for_record:counts,game_status:status,team_score:teamScore,opponent_score:opponentScore,game_result:result,notes:null,canonical_event_id:canonicalId,member_canonical_id:canonicalId};
}
function state(){
  const observations=[
    game({id:"maxpreps-volleyball-results:df-hrdb8f-volleyball-2026:native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2",school:"df-hrdb8f",opponent:"df-jufft8",parser:"maxpreps-scores",event:"native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2",teamScore:0,opponentScore:3,result:"L",canonicalId:BE,source:"maxpreps-volleyball-results:df-hrdb8f-volleyball-2026"}),
    game({id:"maxpreps-volleyball-results:df-jufft8-volleyball-2026:native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2",school:"df-jufft8",opponent:"df-hrdb8f",parser:"maxpreps-scores",event:"native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2",teamScore:3,opponentScore:0,result:"W",canonicalId:BE,source:"maxpreps-volleyball-results:df-jufft8-volleyball-2026"}),
    game({id:"df-hrdb8f-volleyball-2026-official-school-results:beebe|away|1",school:"df-hrdb8f",opponent:"df-jufft8",parser:"mascot-media",event:"beebe|away|1",teamScore:0,opponentScore:0,result:"T",canonicalId:BE,source:"df-hrdb8f-volleyball-2026-official-school-results"}),

    game({id:"df-hrdb8f-volleyball-2026-dragonfly-statewide:native:695c0750c5e8bf402b000008",school:"df-hrdb8f",opponent:"df-vt4unv",parser:"dragonfly-public",event:"native:695c0750c5e8bf402b000008",teamScore:1,opponentScore:3,result:"L",canonicalId:LA}),
    game({id:"df-hrdb8f-volleyball-2026-dragonfly:native:695c0750c5e8bf402b000008",school:"df-hrdb8f",opponent:"df-vt4unv",parser:"dragonfly-public",event:"native:695c0750c5e8bf402b000008",teamScore:1,opponentScore:3,result:"L",canonicalId:LA}),
    game({id:"df-vt4unv-volleyball-2026-dragonfly-statewide:native:695c0750c5e8bf402b000008",school:"df-vt4unv",opponent:"df-hrdb8f",parser:"dragonfly-public",event:"native:695c0750c5e8bf402b000008",teamScore:3,opponentScore:1,result:"W",canonicalId:LA}),
    game({id:"df-vt4unv-volleyball-2026-dragonfly:native:695c0750c5e8bf402b000008",school:"df-vt4unv",opponent:"df-hrdb8f",parser:"dragonfly-public",event:"native:695c0750c5e8bf402b000008",teamScore:3,opponentScore:1,result:"W",canonicalId:LA}),

    game({id:"maxpreps-volleyball-results:df-ht8yyh-volleyball-2026:native:350185fc-ef8a-471b-a26e-1c9f04dfc231",school:"df-ht8yyh",opponent:"df-sz3b5e",parser:"maxpreps-scores",event:"native:350185fc-ef8a-471b-a26e-1c9f04dfc231",teamScore:2,opponentScore:0,result:"W",canonicalId:H1}),
    game({id:"maxpreps-volleyball-results:df-sz3b5e-volleyball-2026:native:350185fc-ef8a-471b-a26e-1c9f04dfc231",school:"df-sz3b5e",opponent:"df-ht8yyh",parser:"maxpreps-scores",event:"native:350185fc-ef8a-471b-a26e-1c9f04dfc231",teamScore:0,opponentScore:2,result:"L",canonicalId:H1}),
    game({id:"maxpreps-volleyball-results:df-ht8yyh-volleyball-2026:native:3fa66510-5b2b-47c8-b51a-642679c44b6a",school:"df-ht8yyh",opponent:"df-sz3b5e",parser:"maxpreps-scores",event:"native:3fa66510-5b2b-47c8-b51a-642679c44b6a",teamScore:3,opponentScore:1,result:"W",canonicalId:H2}),
    game({id:"maxpreps-volleyball-results:df-sz3b5e-volleyball-2026:native:3fa66510-5b2b-47c8-b51a-642679c44b6a",school:"df-sz3b5e",opponent:"df-ht8yyh",parser:"maxpreps-scores",event:"native:3fa66510-5b2b-47c8-b51a-642679c44b6a",teamScore:1,opponentScore:3,result:"L",canonicalId:H2}),

    game({id:"maxpreps-volleyball-results:df-kq5hlr-volleyball-2026:native:441a726d-4c94-4d68-bae8-4101f7d54446",school:"df-kq5hlr",opponent:BSS,parser:"maxpreps-scores",event:"native:441a726d-4c94-4d68-bae8-4101f7d54446",teamScore:2,opponentScore:0,result:"W",canonicalId:C1}),
    game({id:"maxpreps-volleyball-results:df-kq5hlr-volleyball-2026:native:df6a4eed-d762-4c70-abe3-624fd7452bcc",school:"df-kq5hlr",opponent:BSS,parser:"maxpreps-scores",event:"native:df6a4eed-d762-4c70-abe3-624fd7452bcc",teamScore:1,opponentScore:2,result:"L",canonicalId:C2})
  ];
  return {
    canonicals:[
      canonical(BE,"df-jufft8","df-hrdb8f",0,0,{trust_state:"CONFLICT",conflict_count:1}),
      canonical(LA,"df-hrdb8f","df-vt4unv",1,3),
      canonical(H1,"df-ht8yyh","df-sz3b5e",2,0),
      canonical(H2,"df-ht8yyh","df-sz3b5e",3,1),
      canonical(C1,"df-kq5hlr",BSS,2,0,{trust_state:"SINGLE_SOURCE_LIVE"}),
      canonical(C2,BSS,"df-kq5hlr",2,1,{trust_state:"SINGLE_SOURCE_LIVE"})
    ],
    observations,
    conflicts:[{id:6614,canonical_event_id:BE,conflict_type:"SCORE",values_json:'["0-0","3-0"]',resolved_at:null}],
    records:[]
  };
}

test("current production shape requires only the Beebe canonical repair",()=>{
  const classified=classifyRecordTruthRepairState(state());
  assert.equal(classified.safe,true,classified.reasons.join("\n"));
  assert.deepEqual(classified.cases.map(item=>item.action),[
    "repair_canonical","already_complete","already_complete","already_complete"
  ]);
  const beebe=classified.cases[0];
  assert.equal(beebe.placeholder_needs_write,true);
  assert.deepEqual(beebe.active_blocking_conflict_ids,[6614]);
});

test("post-repair shape is fully idempotent",()=>{
  const next=state();
  next.canonicals[0]={...next.canonicals[0],home_score:3,away_score:0,trust_state:"CORROBORATED",conflict_count:0};
  const placeholder=next.observations.find(row=>row.game_id==="df-hrdb8f-volleyball-2026-official-school-results:beebe|away|1");
  Object.assign(placeholder,{game_status:"SCHEDULED",team_score:null,opponent_score:null,game_result:null,counts_for_record:0});
  next.conflicts[0].resolved_at="2026-09-14T12:00:00.000Z";
  const classified=classifyRecordTruthRepairState(next);
  assert.equal(classified.safe,true,classified.reasons.join("\n"));
  assert.deepEqual(classified.cases.map(item=>item.action),[
    "already_complete","already_complete","already_complete","already_complete"
  ]);
});

test("Lakeside verification fails closed if any reciprocal DragonFly row disappears",()=>{
  const next=state();
  next.observations=next.observations.filter(row=>row.game_id!=="df-vt4unv-volleyball-2026-dragonfly:native:695c0750c5e8bf402b000008");
  const classified=classifyRecordTruthRepairState(next);
  assert.equal(classified.safe,false);
  assert.ok(classified.reasons.some(reason=>reason.includes("DragonFly corroborating row is missing or changed")));
});
