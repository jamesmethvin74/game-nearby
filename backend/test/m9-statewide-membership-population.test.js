import test from "node:test";
import assert from "node:assert/strict";
import { buildHighSchoolMembershipPopulation } from "../src/statewide-conference-membership-population.js";

const verifiedAt="2026-09-15T15:00:00.000Z";

function snapshot(){
  return {
    teams:[
      {team_id:"df-vt4unv-volleyball-2026",school_id:"df-vt4unv",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"Lakeside High School",level:"high-school",catalog_scope:"local"},
      {team_id:"aaa-txnuhv-volleyball-2026",school_id:"aaa-txnuhv",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"Lakeside High School",level:"high-school",catalog_scope:"local"},
      {team_id:"df-2tng4g-volleyball-2026",school_id:"df-2tng4g",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,school_name:"Kipp Delta Elementary Literacy Academy",level:"high-school",catalog_scope:"local"}
    ],
    schools:[
      {id:"df-vt4unv",name:"Lakeside High School",mascot:"Rams"},
      {id:"aaa-txnuhv",name:"Lakeside High School",mascot:"Beavers"},
      {id:"df-2tng4g",name:"Kipp Delta Elementary Literacy Academy",mascot:null}
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

test("M9 excludes reviewed non-high-school catalog rows from the statewide membership denominator",()=>{
  const result=buildHighSchoolMembershipPopulation({snapshot:snapshot(),sourceResults:[sourceResult()],verifiedAt});
  assert.equal(result.memberships.some(row=>row.team_id==="df-2tng4g-volleyball-2026"),false);
});
