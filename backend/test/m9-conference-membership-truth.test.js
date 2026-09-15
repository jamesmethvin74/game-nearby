import test from "node:test";
import assert from "node:assert/strict";
import {
  membershipCoverageReport,
  membershipFromSeed,
  membershipPublicStatus,
  normalizeConferenceMembership
} from "../src/conference-membership-truth.js";

const verifiedAt = "2026-09-15T12:00:00.000Z";

test("authoritative member preserves classification, division and provenance", () => {
  const result = membershipPublicStatus({
    team_id:"conway-football-2026",
    membership_state:"member",
    conference_id:"7a-central-football",
    conference_name:"7A Central",
    classification:"7A",
    division:"Central",
    authority_provider:"arkansas-aaa",
    authority_key:"2026:FB:7A-CENTRAL:CONWAY",
    source_url:"https://www.ahsaa.org/",
    verified_at:verifiedAt
  });
  assert.equal(result.conference_membership_state,"member");
  assert.equal(result.conference_id,"7a-central-football");
  assert.equal(result.conference_classification,"7A");
  assert.equal(result.conference_division,"Central");
  assert.equal(result.membership_source,"arkansas-aaa");
});

test("college membership uses the same contract", () => {
  const result = normalizeConferenceMembership({
    team_id:"uca-football-2026",
    membership_state:"member",
    conference_id:"uac",
    classification:"NCAA Division I FCS",
    division:"Division I FCS",
    authority_provider:"official-conference",
    authority_key:"uac:uca:football:2026",
    source_url:"https://uacfootball.com/",
    verified_at:verifiedAt
  });
  assert.equal(result.membership_state,"member");
  assert.equal(result.conference_id,"uac");
});

test("independent and unknown fail closed without a conference id", () => {
  for (const membership_state of ["independent","unknown"]) {
    const result = membershipPublicStatus({
      team_id:`team-${membership_state}`,
      membership_state,
      conference_id:null,
      authority_provider:"official-school",
      authority_key:`2026:${membership_state}`,
      verified_at:verifiedAt
    });
    assert.equal(result.conference_id,null);
    assert.equal(result.conference_name,null);
    assert.equal(result.standing_state,membership_state);
  }
});

test("member without authority evidence is rejected instead of inferred", () => {
  assert.throws(() => normalizeConferenceMembership({
    team_id:"bad",
    membership_state:"member",
    conference_id:"7a-central-football",
    verified_at:verifiedAt
  }),/authority_provider/);
  assert.throws(() => normalizeConferenceMembership({
    team_id:"bad",
    membership_state:"member",
    authority_provider:"arkansas-aaa",
    verified_at:verifiedAt
  }),/conference_id/);
});

test("non-member states cannot silently carry conference membership", () => {
  assert.throws(() => normalizeConferenceMembership({
    team_id:"bad",
    membership_state:"unknown",
    conference_id:"5a-east-football",
    authority_provider:"arkansas-aaa",
    verified_at:verifiedAt
  }),/cannot carry conference_id/);
});

test("coverage is complete only when every row is explicit and none are unknown", () => {
  const rows=[
    {team_id:"a",membership_state:"member",conference_id:"c1",authority_provider:"arkansas-aaa",verified_at:verifiedAt},
    {team_id:"b",membership_state:"independent",authority_provider:"arkansas-aaa",verified_at:verifiedAt}
  ];
  assert.deepEqual(membershipCoverageReport(rows),{
    teams:2,member:1,independent:1,unknown:0,invalid:0,explicit:2,complete:true,unresolved:0,problems:[]
  });
  const incomplete=membershipCoverageReport([...rows,{team_id:"c",membership_state:"unknown",authority_provider:"arkansas-aaa",verified_at:verifiedAt}]);
  assert.equal(incomplete.complete,false);
  assert.equal(incomplete.unresolved,1);
});

test("seed adapter exposes only verified conference membership", () => {
  const member=membershipFromSeed({
    reporting_team_id:"greenbrier-volleyball-2026",
    conference_membership_state:"member",
    verified_conference_id:"5a-central-volleyball",
    verified_conference_name:"5A Central",
    conference_classification:"5A",
    conference_division:"Central",
    membership_authority_provider:"arkansas-aaa",
    membership_authority_key:"2026:WVB:5A-CENTRAL:GREENBRIER",
    membership_verified_at:verifiedAt
  });
  assert.equal(member.conference_id,"5a-central-volleyball");
  assert.equal(member.membership_source,"arkansas-aaa");
  assert.equal(membershipFromSeed({reporting_team_id:"legacy"}),null);
});
