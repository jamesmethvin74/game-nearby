import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFootballConferenceMembership,
  localFootballConferenceId,
  planFootballConferenceMembershipChanges
} from "../src/football-conference-membership.js";

test("football conference membership uses exact normalized school identity", () => {
  const conferences = [
    { id:"5a-south", name:"5A South", source_url:"https://example.test/5a-south" }
  ];
  const standingsByConference = new Map([["5a-south", {
    standings:[
      { school_name:"Parkers Chapel" },
      { school_name:"Camden Fairview" }
    ]
  }]]);
  const localTeams = [
    { team_id:"pc-football", school_id:"pc", school_name:"Parkers Chapel High School", location_matched_name:"Parkers Chapel" },
    { team_id:"cf-football", school_id:"cf", school_name:"Camden Fairview", location_matched_name:"Camden Fairview" }
  ];

  const built = buildFootballConferenceMembership({ conferences, standingsByConference, localTeams });
  assert.equal(localFootballConferenceId("5A-South"), "5a-south-football");
  assert.equal(built.assignments.length, 2);
  assert.deepEqual(new Set(built.assignments.map(row => row.team_id)), new Set(["pc-football", "cf-football"]));
  assert.ok(built.assignments.every(row => row.conference_id === "5a-south-football"));
  assert.equal(built.ambiguous.length, 0);
});

test("ambiguous football school names fail closed instead of guessing", () => {
  const conferences = [{ id:"4a-4", name:"4A 4" }];
  const standingsByConference = new Map([["4a-4", { standings:[{ school_name:"Southside" }] }]]);
  const localTeams = [
    { team_id:"southside-a", school_id:"a", school_name:"Southside", location_matched_name:"Southside" },
    { team_id:"southside-b", school_id:"b", school_name:"Southside", location_matched_name:"Southside" }
  ];

  const built = buildFootballConferenceMembership({ conferences, standingsByConference, localTeams });
  assert.equal(built.assignments.length, 0);
  assert.equal(built.ambiguous.length, 1);
  assert.deepEqual(new Set(built.ambiguous[0].candidates), new Set(["southside-a", "southside-b"]));
});

test("football membership plan separates aligned, missing, and wrong rows", () => {
  const assignments = [
    { team_id:"a", school_id:"a-school", conference_id:"6a-central-football", conference_name:"6A Central" },
    { team_id:"b", school_id:"b-school", conference_id:"5a-central-football", conference_name:"5A Central" },
    { team_id:"c", school_id:"c-school", conference_id:"4a-4-football", conference_name:"4A 4" }
  ];
  const localTeams = [
    { team_id:"a", school_name:"A", conference_id:"6a-central-football" },
    { team_id:"b", school_name:"B", conference_id:null },
    { team_id:"c", school_name:"C", conference_id:"wrong-football" }
  ];

  const plan = planFootballConferenceMembershipChanges({ assignments, localTeams });
  assert.equal(plan.aligned_count, 1);
  assert.equal(plan.missing_count, 1);
  assert.equal(plan.wrong_count, 1);
  assert.equal(plan.change_count, 2);
});
