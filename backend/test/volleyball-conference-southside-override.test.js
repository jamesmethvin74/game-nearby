import test from "node:test";
import assert from "node:assert/strict";
import { buildVolleyballConferenceMembership } from "../src/volleyball-conference-membership.js";

test("Southside resolves to Batesville in 4A 4 and Fort Smith in 6A West",()=>{
  const localTeams=[
    {
      team_id:"df-s3xu7u-volleyball-2026",
      school_id:"df-s3xu7u",
      school_name:"Southside Charter High School",
      location_matched_name:"Southside High School"
    },
    {
      team_id:"df-jh2s9b-volleyball-2026",
      school_id:"df-jh2s9b",
      school_name:"SOUTHSIDE HIGH SCHOOL",
      location_matched_name:"Southside High School"
    }
  ];
  const conferences=[
    {id:"4a-4",name:"4A 4",source_url:"https://example.test/4a-4"},
    {id:"6a-west",name:"6A West",source_url:"https://example.test/6a-west"}
  ];
  const standingsByConference=new Map([
    ["4a-4",{standings:[{school_name:"Southside"}]}],
    ["6a-west",{standings:[{school_name:"Southside"}]}]
  ]);

  const built=buildVolleyballConferenceMembership({conferences,standingsByConference,localTeams});
  const assignments=new Map(built.assignments.map(row=>[row.team_id,row.conference_id]));

  assert.equal(assignments.get("df-s3xu7u-volleyball-2026"),"4a-4-volleyball");
  assert.equal(assignments.get("df-jh2s9b-volleyball-2026"),"6a-west-volleyball");
  assert.equal(built.ambiguous.length,0);
  assert.equal(built.unmatched.length,0);
});
