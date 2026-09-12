import assert from "node:assert/strict";
import test from "node:test";
import { buildSchoolIdentityIndex, resolveSchoolIdentity } from "../src/school-identity-resolution.js";
import { schoolIdentityAuditFindings, augmentAuditWithSchoolIdentityFindings } from "../src/school-identity-audit.js";
import { attachDragonFlyOpponentIdentities } from "../src/dragonfly-school-identities.js";

const conway = {
  id:"conway",
  name:"Conway High School",
  mascot:"Wampus Cats",
  alternate_names:["Conway"]
};

function volleyballTeam(overrides={}) {
  return {
    team_id:"conway-volleyball-2026",
    school_id:"conway",
    school_name:"Conway",
    raw_school_name:"Conway High School",
    location_matched_name:"Conway",
    mascot:"Wampus Cats",
    conference_id:"6a-central-volleyball",
    conference_name:"6A Central",
    ...overrides
  };
}

test("normalizes school-name and mascot variants to the same canonical school", () => {
  const index = buildSchoolIdentityIndex({ schools:[conway] });
  const high = resolveSchoolIdentity({ observedName:"Conway High" }, index);
  const mascot = resolveSchoolIdentity({ observedName:"Conway Wampus Cats" }, index);
  const full = resolveSchoolIdentity({ observedName:"CONWAY HIGH SCHOOL, AR" }, index);

  assert.equal(high.status, "resolved");
  assert.equal(high.schoolId, "conway");
  assert.equal(mascot.status, "resolved");
  assert.equal(mascot.schoolId, "conway");
  assert.equal(full.status, "resolved");
  assert.equal(full.schoolId, "conway");
});

test("provider external identity wins even when the observed name changes", () => {
  const index = buildSchoolIdentityIndex({
    schools:[conway],
    externalIdentities:[{ provider:"dragonfly", external_school_id:"C0NW4Y", school_id:"conway", observed_name:"Conway High School" }]
  });
  const resolution = resolveSchoolIdentity({
    observedName:"Conway Senior Campus",
    provider:"dragonfly",
    externalSchoolId:"c0nw4y"
  }, index);

  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.schoolId, "conway");
  assert.equal(resolution.method, "external-id");
});

test("ambiguous normalized names fail closed instead of picking the first school", () => {
  const index = buildSchoolIdentityIndex({
    schools:[
      { id:"central-a", name:"Central High School", mascot:"Tigers" },
      { id:"central-b", name:"Central School", mascot:"Eagles" }
    ]
  });
  const resolution = resolveSchoolIdentity({ observedName:"Central High" }, index);

  assert.equal(resolution.status, "ambiguous");
  assert.deepEqual(resolution.candidateSchoolIds, ["central-a", "central-b"]);
  assert.equal(resolution.schoolId, null);
});

test("DragonFly opponent organization code survives normalization for identity resolution", () => {
  const payload = {
    schedule:[{
      eventId:"event-1",
      participants:[
        { name:"GREENBRIER HIGH SCHOOL", orgShortCode:"SE48QJ" },
        { name:"VILONIA HIGH SCHOOL", orgShortCode:"YF5Y8Q" }
      ]
    }]
  };
  const events = [{ nativeId:"event-1", opponent:"VILONIA HIGH SCHOOL" }];
  const enriched = attachDragonFlyOpponentIdentities(payload, { school_name:"Greenbrier High School" }, events);

  assert.equal(enriched[0].opponentProvider, "dragonfly");
  assert.equal(enriched[0].opponentExternalSchoolId, "YF5Y8Q");
});

test("audit recognizes a deterministic alias gap instead of calling Conway unresolved", () => {
  const teams = [volleyballTeam()];
  const candidates = [{
    team_id:"other-volleyball-2026",
    opponent:"Conway Wampus Cats",
    opponent_school_id:null,
    canonical_event_id:null,
    status:"SCHEDULED"
  }];
  const findings = schoolIdentityAuditFindings({ teams, candidates });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].deficiency_type, "school_identity_alias_gap");
  assert.match(findings[0].authority_state, /conway/);
  assert.deepEqual(findings[0].details.candidate_school_ids, ["conway"]);
});

test("audit surfaces unresolved and ambiguous identities as first-class exceptions", () => {
  const teams = [
    volleyballTeam(),
    volleyballTeam({ team_id:"central-a-vb", school_id:"central-a", school_name:"Central", raw_school_name:"Central High School", location_matched_name:"Central", mascot:"Tigers" }),
    volleyballTeam({ team_id:"central-b-vb", school_id:"central-b", school_name:"Central", raw_school_name:"Central School", location_matched_name:"Central", mascot:"Eagles" })
  ];
  const candidates = [
    { team_id:"conway-volleyball-2026", opponent:"Mystery Academy", opponent_school_id:null, canonical_event_id:null, status:"SCHEDULED" },
    { team_id:"conway-volleyball-2026", opponent:"Central High", opponent_school_id:null, canonical_event_id:null, status:"FINAL" }
  ];
  const baseAudit = {
    summary:{ exception_count:2 },
    exceptions_by_deficiency:{ existing_problem:{ count:2, exceptions:[] } }
  };
  const result = augmentAuditWithSchoolIdentityFindings(baseAudit, { teams, candidates });

  assert.equal(result.summary.unresolved_school_identity_count, 1);
  assert.equal(result.summary.ambiguous_school_identity_count, 1);
  assert.equal(result.summary.school_identity_exception_count, 2);
  assert.equal(result.summary.teams_with_school_identity_exceptions, 1);
  assert.equal(result.summary.exception_count, 4);
  assert.equal(result.exceptions_by_deficiency.unresolved_school_identity.count, 1);
  assert.equal(result.exceptions_by_deficiency.ambiguous_school_identity.count, 1);
});

test("audit ignores legitimate placeholder opponents", () => {
  const findings = schoolIdentityAuditFindings({
    teams:[volleyballTeam()],
    candidates:[
      { team_id:"conway-volleyball-2026", opponent:"TBD", opponent_school_id:null, canonical_event_id:null, status:"SCHEDULED" },
      { team_id:"conway-volleyball-2026", opponent:"Winner of Match 4", opponent_school_id:null, canonical_event_id:null, status:"SCHEDULED" }
    ]
  });
  assert.deepEqual(findings, []);
});
