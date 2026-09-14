import test from "node:test";
import assert from "node:assert/strict";

import { classifyRecordTruthRepairState, NEW_CANONICAL_IDS } from "../src/record-truth-production-repair.js";

function canonical({id,a,b,home,away,homeScore,awayScore,status="FINAL"}){
  return {id,participant_a_school_id:a,participant_b_school_id:b,home_school_id:home,away_school_id:away,status,home_score:homeScore,away_score:awayScore,selected_source_id:"source",trust_state:"CORROBORATED",conflict_count:0};
}
function game({id,teamId,schoolId,opponentId,contestId,teamScore,opponentScore,result,homeAway="home",canonicalId,parser="maxpreps-scores",sourceId="mp"}){
  return {game_id:id,team_id:teamId,reporting_school_id:schoolId,opponent_school_id:opponentId,source_id:sourceId,parser_type:parser,authority_rank:80,
    source_event_key:`native:${contestId}`,scheduled_at:"2026-08-29T17:00:00.000Z",scheduled_time_known:0,venue:null,location_text:null,latitude:null,longitude:null,
    home_away:homeAway,conference_game:0,counts_for_record:1,game_status:"FINAL",team_score:teamScore,opponent_score:opponentScore,game_result:result,notes:null,
    canonical_event_id:canonicalId,member_canonical_id:canonicalId};
}
function baseState(){
  const beebe="ce:volleyball:girls:2026:df-hrdb8f:df-jufft8:20260824:t1630";
  const lakeside="ce:volleyball:girls:2026:df-hrdb8f:df-vt4unv:20260827:df-695c0750c5e8bf402b000008";
  const harrison="ce:volleyball:girls:2026:df-ht8yyh:df-sz3b5e:20260829:mp-350185fc-ef8a-471b-a26e-1c9f04dfc231";
  const cabot="ce:volleyball:girls:2026:df-kq5hlr:mp-xe6tf6lf7uco1soenbisnw-7a263f82:20260829:mp-441a726d-4c94-4d68-bae8-4101f7d54446";
  const bss="mp-xe6tf6lf7uco1soenbisnw-7a263f82";
  return {
    canonicals:[
      canonical({id:beebe,a:"df-hrdb8f",b:"df-jufft8",home:"df-jufft8",away:"df-hrdb8f",homeScore:0,awayScore:0}),
      canonical({id:lakeside,a:"df-hrdb8f",b:"df-vt4unv",home:"df-hrdb8f",away:"df-vt4unv",homeScore:3,awayScore:1}),
      canonical({id:harrison,a:"df-ht8yyh",b:"df-sz3b5e",home:"df-ht8yyh",away:"df-sz3b5e",homeScore:2,awayScore:0}),
      canonical({id:cabot,a:"df-kq5hlr",b:bss,home:"df-kq5hlr",away:bss,homeScore:2,awayScore:0})
    ],
    observations:[
      game({id:"beebe-mp",teamId:"df-jufft8-volleyball-2026",schoolId:"df-jufft8",opponentId:"df-hrdb8f",contestId:"eccd4ee4-19ba-4805-8f3e-76057b40f3e2",teamScore:3,opponentScore:0,result:"W",homeAway:"home",canonicalId:beebe}),
      game({id:"nlr-mp",teamId:"df-hrdb8f-volleyball-2026",schoolId:"df-hrdb8f",opponentId:"df-jufft8",contestId:"eccd4ee4-19ba-4805-8f3e-76057b40f3e2",teamScore:0,opponentScore:3,result:"L",homeAway:"away",canonicalId:beebe}),
      game({id:"beebe-placeholder",teamId:"df-jufft8-volleyball-2026",schoolId:"df-jufft8",opponentId:"df-hrdb8f",contestId:"placeholder",teamScore:0,opponentScore:0,result:"T",homeAway:"home",canonicalId:beebe,parser:"mascot-media",sourceId:"beebe-school"}),
      game({id:"nlr-lake-mp",teamId:"df-hrdb8f-volleyball-2026",schoolId:"df-hrdb8f",opponentId:"df-vt4unv",contestId:"c15af614-2501-4437-ad9e-2a87b7d3b991",teamScore:1,opponentScore:3,result:"L",homeAway:"home",canonicalId:lakeside}),
      game({id:"lake-mp",teamId:"df-vt4unv-volleyball-2026",schoolId:"df-vt4unv",opponentId:"df-hrdb8f",contestId:"c15af614-2501-4437-ad9e-2a87b7d3b991",teamScore:3,opponentScore:1,result:"W",homeAway:"away",canonicalId:lakeside}),
      game({id:"nlr-stale-result",teamId:"df-hrdb8f-volleyball-2026",schoolId:"df-hrdb8f",opponentId:"df-vt4unv",contestId:"other",teamScore:3,opponentScore:1,result:"W",homeAway:"home",canonicalId:lakeside,parser:"dragonfly-public",sourceId:"dragonfly"}),
      game({id:"har-first",teamId:"df-ht8yyh-volleyball-2026",schoolId:"df-ht8yyh",opponentId:"df-sz3b5e",contestId:"350185fc-ef8a-471b-a26e-1c9f04dfc231",teamScore:2,opponentScore:0,result:"W",homeAway:"home",canonicalId:harrison}),
      game({id:"cot-first",teamId:"df-sz3b5e-volleyball-2026",schoolId:"df-sz3b5e",opponentId:"df-ht8yyh",contestId:"350185fc-ef8a-471b-a26e-1c9f04dfc231",teamScore:0,opponentScore:2,result:"L",homeAway:"away",canonicalId:harrison}),
      game({id:"har-second",teamId:"df-ht8yyh-volleyball-2026",schoolId:"df-ht8yyh",opponentId:"df-sz3b5e",contestId:"3fa66510-5b2b-47c8-b51a-642679c44b6a",teamScore:3,opponentScore:1,result:"W",homeAway:"home",canonicalId:harrison}),
      game({id:"cot-second",teamId:"df-sz3b5e-volleyball-2026",schoolId:"df-sz3b5e",opponentId:"df-ht8yyh",contestId:"3fa66510-5b2b-47c8-b51a-642679c44b6a",teamScore:1,opponentScore:3,result:"L",homeAway:"away",canonicalId:harrison}),
      game({id:"cabot-first",teamId:"df-kq5hlr-volleyball-2026",schoolId:"df-kq5hlr",opponentId:bss,contestId:"441a726d-4c94-4d68-bae8-4101f7d54446",teamScore:2,opponentScore:0,result:"W",homeAway:"home",canonicalId:cabot}),
      game({id:"cabot-second",teamId:"df-kq5hlr-volleyball-2026",schoolId:"df-kq5hlr",opponentId:bss,contestId:"df6a4eed-d762-4c70-abe3-624fd7452bcc",teamScore:1,opponentScore:2,result:"L",homeAway:"home",canonicalId:cabot})
    ],
    conflicts:[],records:[]
  };
}

test("four remaining cases classify into two canonical repairs and two rematch splits",()=>{
  const classified=classifyRecordTruthRepairState(baseState());
  assert.equal(classified.safe,true,classified.reasons.join("\n"));
  assert.deepEqual(classified.cases.map(row=>row.action),["repair_canonical","repair_canonical","split_rematch","split_rematch"]);
  const beebe=classified.cases[0];
  assert.deepEqual(beebe.placeholder_game_ids,["beebe-placeholder"]);
  const lakeside=classified.cases[1];
  assert.deepEqual(lakeside.neutralize_result_game_ids,["nlr-stale-result"]);
  const harrison=classified.cases[2];
  assert.deepEqual(harrison.move_game_ids,["cot-second","har-second"]);
  assert.equal(harrison.new_canonical_id,NEW_CANONICAL_IDS["harrison-cotter-rematch-20260829"]);
  const cabot=classified.cases[3];
  assert.deepEqual(cabot.move_game_ids,["cabot-second"]);
});

test("already repaired state is idempotent",()=>{
  const state=baseState();
  const classified=classifyRecordTruthRepairState(state);
  const beebe=classified.cases[0],lakeside=classified.cases[1],harrison=classified.cases[2],cabot=classified.cases[3];
  state.canonicals[0]={...state.canonicals[0],...beebe.target};
  state.canonicals[1]={...state.canonicals[1],...lakeside.target};
  state.observations=state.observations.filter(row=>row.game_id!=="beebe-placeholder"&&row.game_id!=="nlr-stale-result");
  state.canonicals.push(canonical({id:harrison.new_canonical_id,a:harrison.second_target.participant_a_school_id,b:harrison.second_target.participant_b_school_id,home:harrison.second_target.home_school_id,away:harrison.second_target.away_school_id,homeScore:harrison.second_target.home_score,awayScore:harrison.second_target.away_score}));
  state.canonicals.push(canonical({id:cabot.new_canonical_id,a:cabot.second_target.participant_a_school_id,b:cabot.second_target.participant_b_school_id,home:cabot.second_target.home_school_id,away:cabot.second_target.away_school_id,homeScore:cabot.second_target.home_score,awayScore:cabot.second_target.away_score}));
  state.observations=state.observations.map(row=>{
    if(["har-second","cot-second"].includes(row.game_id)) return {...row,canonical_event_id:harrison.new_canonical_id,member_canonical_id:harrison.new_canonical_id};
    if(row.game_id==="cabot-second") return {...row,canonical_event_id:cabot.new_canonical_id,member_canonical_id:cabot.new_canonical_id};
    return row;
  });
  const final=classifyRecordTruthRepairState(state);
  assert.equal(final.safe,true,final.reasons.join("\n"));
  assert.deepEqual(final.cases.map(row=>row.action),["already_complete","already_complete","already_complete","already_complete"]);
});
