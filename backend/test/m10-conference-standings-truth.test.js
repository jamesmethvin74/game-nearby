import test from "node:test";
import assert from "node:assert/strict";
import {
  cohortTruthState,
  crossCheckPublishedStandings,
  rankCanonicalConferenceRows,
  reconcileConferenceStandings
} from "../src/conference-standings-truth.js";

const rows=[
  {team_id:"a",school_name:"Alpha",conference_record:"2-0",overall_record:"4-1",method:"calculated"},
  {team_id:"b",school_name:"Beta",conference_record:"2-0",overall_record:"3-2",method:"calculated"},
  {team_id:"c",school_name:"Gamma",conference_record:"1-1",overall_record:"2-3",method:"calculated"}
];

test("complete canonical cohort uses competition ranking", () => {
  const ranked=rankCanonicalConferenceRows(rows,{membershipComplete:true,resultEvidenceComplete:true});
  assert.deepEqual(ranked.map(row=>[row.team_id,row.rank,row.standing_state]),[
    ["a",1,"ranked"],["b",1,"ranked"],["c",3,"ranked"]
  ]);
  assert.ok(ranked.every(row=>row.standings_verified));
});

test("incomplete membership withholds every calculated rank", () => {
  const ranked=rankCanonicalConferenceRows(rows,{membershipComplete:false,resultEvidenceComplete:true});
  assert.ok(ranked.every(row=>row.rank===null));
  assert.ok(ranked.every(row=>row.standing_state==="unavailable"));
  assert.ok(ranked.every(row=>row.standings_verified===false));
});

test("unresolved result evidence withholds every calculated rank", () => {
  const ranked=rankCanonicalConferenceRows(rows,{membershipComplete:true,resultEvidenceComplete:false});
  assert.ok(ranked.every(row=>row.rank===null));
  assert.ok(ranked.every(row=>row.standing_state==="unavailable"));
});

test("zero conference games is known membership with 0-0 and no rank", () => {
  const ranked=rankCanonicalConferenceRows([
    {team_id:"a",school_name:"Alpha",conference_record:"0-0",overall_record:"1-0"},
    {team_id:"b",school_name:"Beta",conference_record:"0-0",overall_record:"0-1"}
  ],{membershipComplete:true,resultEvidenceComplete:true});
  assert.deepEqual(ranked.map(row=>[row.conference_record,row.rank,row.standing_state]),[
    ["0-0",null,"not-started"],["0-0",null,"not-started"]
  ]);
});

test("published agreement is a cross-check and never replaces canonical truth", () => {
  const checked=crossCheckPublishedStandings([rows[0]],[{
    school_name:"Alpha High School",rank:7,conference_record:"2-0",overall_record:"4-1"
  }]);
  assert.equal(checked[0].conference_record,"2-0");
  assert.equal(checked[0].overall_record,"4-1");
  assert.equal(checked[0].published_rank,7);
  assert.equal(checked[0].published_cross_check,"verified");
});

test("published disagreement is explicit but cannot overwrite canonical record", () => {
  const checked=crossCheckPublishedStandings([rows[0]],[{
    school_name:"Alpha",rank:1,conference_record:"3-0",overall_record:"5-0"
  }]);
  assert.equal(checked[0].conference_record,"2-0");
  assert.equal(checked[0].overall_record,"4-1");
  assert.equal(checked[0].published_conference_record,"3-0");
  assert.equal(checked[0].published_overall_record,"5-0");
  assert.equal(checked[0].published_cross_check,"contradictory");
});

test("published-only table is exposed as unverified source evidence, not standings truth", () => {
  const result=reconcileConferenceStandings({
    calculated:null,
    published:{conference:{id:"5a-central",name:"5A Central"},standings:[{school_name:"Alpha",rank:1,conference_record:"3-0",overall_record:"5-0"}]}
  });
  assert.equal(result.conference.standings_method,"source-published");
  assert.equal(result.conference.coverage_complete,false);
  assert.equal(result.standings[0].rank,null);
  assert.equal(result.standings[0].conference_record,null);
  assert.equal(result.standings[0].overall_record,null);
  assert.equal(result.standings[0].published_rank,1);
  assert.equal(result.standings[0].published_conference_record,"3-0");
  assert.equal(result.standings[0].standing_state,"source-published");
  assert.equal(result.standings[0].standings_verified,false);
  assert.equal(result.standings[0].display_rank,1);
  assert.equal(result.standings[0].display_conference_record,"3-0");
  assert.equal(result.standings[0].display_overall_record,"5-0");
  assert.equal(result.standings[0].display_method,"published");
  assert.equal(result.conference.presentation_complete,true);
});

test("complete local truth stays authoritative even when published evidence exists", () => {
  const result=reconcileConferenceStandings({
    calculated:{conference:{id:"5a-central",name:"5A Central"},standings:rows},
    published:{conference:{id:"5a-central",name:"5A Central"},standings:[
      {school_name:"Alpha",rank:9,conference_record:"9-0",overall_record:"9-0"},
      {school_name:"Beta",rank:1,conference_record:"2-0",overall_record:"3-2"}
    ]},
    membershipComplete:true,
    resultEvidenceComplete:true
  });
  assert.equal(result.conference.standings_method,"calculated");
  assert.equal(result.conference.coverage_complete,true);
  assert.deepEqual(result.standings.map(row=>row.rank),[1,1,3]);
  assert.equal(result.standings.find(row=>row.team_id==="a").conference_record,"2-0");
  assert.equal(result.standings.find(row=>row.team_id==="a").published_cross_check,"contradictory");
});

test("cohort truth requires explicit membership and clean final evidence", () => {
  assert.deepEqual(cohortTruthState({expectedMembers:8,explicitMembers:8}),{
    membership_complete:true,result_evidence_complete:true,coverage_complete:true,
    expected_members:8,explicit_members:8,unknown_members:0,invalid_memberships:0,
    unresolved_finals:0,contradictory_finals:0,source_gaps:0
  });
  const membershipGap=cohortTruthState({expectedMembers:8,explicitMembers:7,unknownMembers:1});
  assert.equal(membershipGap.coverage_complete,false);
  assert.equal(membershipGap.membership_complete,false);
  const resultGap=cohortTruthState({expectedMembers:8,explicitMembers:8,unresolvedFinals:1});
  assert.equal(resultGap.coverage_complete,false);
  assert.equal(resultGap.result_evidence_complete,false);
});


test("incomplete canonical truth stays on canonical values and uses published data only as cross-check evidence", () => {
  const result=reconcileConferenceStandings({
    calculated:{conference:{id:"7a-west",name:"7A West"},standings:[
      {team_id:"a",school_name:"Alpha",conference_record:"0-0",overall_record:"1-0",method:"calculated"}
    ]},
    published:{conference:{id:"7a-west",name:"7A West",source_url:"https://example.test"},standings:[
      {school_name:"Alpha",rank:2,conference_record:"0-0",overall_record:"3-0",source_url:"https://example.test"}
    ]},
    membershipComplete:true,
    resultEvidenceComplete:false
  });
  const row=result.standings[0];
  assert.equal(row.rank,null,"canonical rank remains withheld");
  assert.equal(row.overall_record,"1-0","canonical local record remains intact");
  assert.equal(row.display_rank,null,"incomplete canonical rank remains withheld");
  assert.equal(row.display_conference_record,"0-0");
  assert.equal(row.display_overall_record,"1-0");
  assert.equal(row.display_method,"canonical-unverified");
  assert.equal(result.conference.presentation_method,"canonical-unverified");
  assert.equal(result.conference.presentation_complete,true);
});
