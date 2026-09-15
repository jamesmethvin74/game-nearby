import test from "node:test";
import assert from "node:assert/strict";
import { buildHighSchoolMembershipPopulation } from "../src/statewide-conference-membership-population.js";

const verifiedAt="2026-09-15T15:00:00.000Z";

function snapshot(){
  return {
    teams:[
      {team_id:"df-vt4unv-volleyball-2026",school_id:"df-vt4unv",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"Lakeside High School",level:"high-school",catalog_scope:"local"},
      {team_id:"aaa-txnuhv-volleyball-2026",school_id:"aaa-txnuhv",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"Lakeside High School",level:"high-school",catalog_scope:"local"},
      {team_id:"df-2tng4g-volleyball-2026",school_id:"df-2tng4g",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"Kipp Delta Elementary Literacy Academy",level:"high-school",catalog_scope:"local"},
      {team_id:"aaa-rp6yzq-football-2026",school_id:"aaa-rp6yzq",sport:"football",gender:"boys",season:"2026",conference_id:null,school_name:"Forest City High School",level:"high-school",catalog_scope:"local"}
    ],
    schools:[
      {id:"df-vt4unv",name:"Lakeside High School",mascot:"Rams"},
      {id:"aaa-txnuhv",name:"Lakeside High School",mascot:"Beavers"},
      {id:"df-2tng4g",name:"Kipp Delta Elementary Literacy Academy",mascot:null},
      {id:"aaa-rp6yzq",name:"Forest City High School",mascot:"Mustangs"}
    ],
    aliases:[]
  };
}

function sourceResult(){
  return {
    source:{key:"volleyball-girls",sport:"volleyball",gender:"girls",authorityProvider:"maxpreps-aaa-partner",directoryUrl:"https://www.maxpreps.com/ar/volleyball/"},
    discovered_conferences:1,
    fetched_conferences:1,
    failures:[],
    rosters:[{
      conference:{id:"5a-south",name:"5A South",source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/5a-south/"},
      schools:["Lakeside"]
    }]
  };
}

test("M9 exact conference context resolves duplicate Lakeside names and leaves the other team unknown",()=>{
  const result=buildHighSchoolMembershipPopulation({snapshot:snapshot(),sourceResults:[sourceResult()],verifiedAt});
  const byTeam=new Map(result.memberships.map(row=>[row.team_id,row]));
  assert.equal(byTeam.get("df-vt4unv-volleyball-2026")?.membership_state,"member");
  assert.equal(byTeam.get("df-vt4unv-volleyball-2026")?.conference_id,"5a-south-volleyball");
  assert.equal(byTeam.get("aaa-txnuhv-volleyball-2026")?.membership_state,"unknown");
});

test("M9 excludes reviewed non-high-school and duplicate catalog rows from the statewide membership denominator",()=>{
  const result=buildHighSchoolMembershipPopulation({snapshot:snapshot(),sourceResults:[sourceResult()],verifiedAt});
  assert.equal(result.memberships.some(row=>row.team_id==="df-2tng4g-volleyball-2026"),false);
  assert.equal(result.memberships.some(row=>row.team_id==="aaa-rp6yzq-football-2026"),false);
});

test("M9 curated residual aliases resolve only the exact local school identities",()=>{
  const localSnapshot={
    teams:[
      {team_id:"df-28tzpd-volleyball-2026",school_id:"df-28tzpd",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"NEMO VISTA HIGH SCHOOL - (6-12)",level:"high-school",catalog_scope:"local"},
      {team_id:"df-qlkhe2-volleyball-2026",school_id:"df-qlkhe2",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"West Fork High School - (7-12)",level:"high-school",catalog_scope:"local"},
      {team_id:"df-qyakr5-volleyball-2026",school_id:"df-qyakr5",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"Lonoke High School (7-12 Athletics)",level:"high-school",catalog_scope:"local"},
      {team_id:"df-ktr7yd-volleyball-2026",school_id:"df-ktr7yd",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"UNION CHRISTIAN ACADEMY 7-12",level:"high-school",catalog_scope:"local"}
    ],
    schools:[
      {id:"df-28tzpd",name:"NEMO VISTA HIGH SCHOOL - (6-12)"},
      {id:"df-qlkhe2",name:"West Fork High School - (7-12)"},
      {id:"df-qyakr5",name:"Lonoke High School (7-12 Athletics)"},
      {id:"df-ktr7yd",name:"UNION CHRISTIAN ACADEMY 7-12"}
    ],
    aliases:[]
  };
  const source={key:"volleyball-girls",sport:"volleyball",gender:"girls",authorityProvider:"maxpreps-aaa-partner",directoryUrl:"https://www.maxpreps.com/ar/volleyball/"};
  const sourceResults=[
    {source,discovered_conferences:4,fetched_conferences:4,failures:[],rosters:[
      {conference:{id:"2a-4",name:"2A-4",source_url:"https://example.test/nemo"},schools:["Nemo Vista"]},
      {conference:{id:"3a-1",name:"3A-1",source_url:"https://example.test/west-fork"},schools:["West Fork"]},
      {conference:{id:"4a-4",name:"4A-4",source_url:"https://example.test/lonoke"},schools:["Lonoke"]},
      {conference:{id:"2a-3",name:"2A-3",source_url:"https://example.test/union"},schools:["Union Christian Academy"]}
    ]}
  ];
  const result=buildHighSchoolMembershipPopulation({snapshot:localSnapshot,sourceResults,verifiedAt});
  const byTeam=new Map(result.memberships.map(row=>[row.team_id,row]));
  assert.equal(byTeam.get("df-28tzpd-volleyball-2026")?.conference_id,"2a-4-volleyball");
  assert.equal(byTeam.get("df-qlkhe2-volleyball-2026")?.conference_id,"3a-1-volleyball");
  assert.equal(byTeam.get("df-qyakr5-volleyball-2026")?.conference_id,"4a-4-volleyball");
  assert.equal(byTeam.get("df-ktr7yd-volleyball-2026")?.conference_id,"2a-3-volleyball");
});

test("M9 Central soccer override is conference-specific and resolves Little Rock Central",()=>{
  const localSnapshot={
    teams:[{team_id:"df-t2mq54-boys-soccer-2026",school_id:"df-t2mq54",sport:"soccer",gender:"boys",season:"2026",conference_id:null,school_name:"Little Rock Central High School",level:"high-school",catalog_scope:"local"}],
    schools:[{id:"df-t2mq54",name:"Little Rock Central High School"}],
    aliases:[]
  };
  const source={key:"soccer-boys",sport:"soccer",gender:"boys",authorityProvider:"maxpreps-aaa-partner",directoryUrl:"https://www.maxpreps.com/ar/soccer/"};
  const sourceResults=[{source,discovered_conferences:1,fetched_conferences:1,failures:[],rosters:[{conference:{id:"6a-central",name:"6A Central",source_url:"https://example.test/central"},schools:["Central"]}]}];
  const result=buildHighSchoolMembershipPopulation({snapshot:localSnapshot,sourceResults,verifiedAt});
  const membership=result.memberships.find(row=>row.team_id==="df-t2mq54-boys-soccer-2026");
  assert.equal(membership?.membership_state,"member");
  assert.equal(membership?.conference_id,"6a-central-soccer-boys");
});
