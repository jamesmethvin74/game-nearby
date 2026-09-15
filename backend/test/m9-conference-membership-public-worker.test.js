import test from "node:test";
import assert from "node:assert/strict";
import { applyMembershipTruthToStatuses } from "../src/conference-membership-public-worker.js";

const verifiedAt="2026-09-15T12:00:00Z";

function status(teamId, conferenceId="legacy-conference") {
  return {
    team_id:teamId,
    conference_id:conferenceId,
    conference_name:"Legacy Conference",
    conference_record:"2-0",
    conference_games:2,
    rank:1,
    standing_state:"ranked"
  };
}

test("durable member truth replaces legacy/inferred conference identity", () => {
  const result=applyMembershipTruthToStatuses([status("a")],[{
    team_id:"a",membership_state:"member",conference_id:"7a-central-football",conference_name:"7A Central",
    classification:"7A",division:"Central",authority_provider:"arkansas-aaa",authority_key:"2026:FB:A",
    source_url:"https://www.ahsaa.org/",verified_at:verifiedAt
  }])[0];
  assert.equal(result.conference_id,"7a-central-football");
  assert.equal(result.conference_name,"7A Central");
  assert.equal(result.conference_record,null,"record from a different legacy conference cannot leak across membership change");
  assert.equal(result.rank,null);
  assert.equal(result.standing_state,"unavailable");
  assert.equal(result.membership_source,"arkansas-aaa");
});

test("matching durable member preserves same-conference record and rank", () => {
  const source=status("a","7a-central-football");
  const result=applyMembershipTruthToStatuses([source],[{
    team_id:"a",membership_state:"member",conference_id:"7a-central-football",conference_name:"7A Central",
    authority_provider:"arkansas-aaa",authority_key:"2026:FB:A",verified_at:verifiedAt
  }])[0];
  assert.equal(result.conference_record,"2-0");
  assert.equal(result.rank,1);
  assert.equal(result.standing_state,"ranked");
});

test("independent truth clears conference record and rank", () => {
  const result=applyMembershipTruthToStatuses([status("a")],[{
    team_id:"a",membership_state:"independent",conference_id:null,
    authority_provider:"arkansas-aaa",authority_key:"2026:FB:A",verified_at:verifiedAt
  }])[0];
  assert.equal(result.conference_id,null);
  assert.equal(result.conference_record,null);
  assert.equal(result.rank,null);
  assert.equal(result.standing_state,"independent");
});

test("missing durable truth fails closed even if legacy code inferred a conference", () => {
  const result=applyMembershipTruthToStatuses([status("a")],[])[0];
  assert.equal(result.conference_membership_state,"unknown");
  assert.equal(result.conference_id,null);
  assert.equal(result.conference_name,null);
  assert.equal(result.conference_record,null);
  assert.equal(result.rank,null);
  assert.equal(result.standing_state,"unknown");
});
