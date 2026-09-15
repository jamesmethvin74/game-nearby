import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPublishedCompletenessCrossCheck,
  applyStandingsTruthToStatuses,
  conferenceStandingsId
} from "../src/conference-membership-public-worker.js";

function status(overrides={}) {
  return {
    team_id:"a",school_name:"Alpha High School",sport:"football",season:"2026",
    conference_membership_state:"member",conference_id:"7a-central-football",
    conference_games:2,conference_record:"2-0",overall_games:4,overall_record:"4-0",
    rank:null,standing_state:"unavailable",record_verified:true,record_state:"VERIFIED",
    record_audit_state:"VERIFIED",record_issues:[],...overrides
  };
}

test("team detail accepts calculated rank only when canonical conference record agrees", () => {
  const truth=new Map([["football|7a-central-football",{
    conference:{coverage_complete:true},
    standings:[{
      team_id:"a",school_name:"Alpha",conference_record:"2-0",overall_record:"4-0",
      rank:1,standing_state:"ranked",standings_verified:true,published_cross_check:"verified",
      published_conference_record:"2-0",published_overall_record:"4-0",published_rank:1
    }]
  }]]);
  const result=applyStandingsTruthToStatuses([status()],truth)[0];
  assert.equal(result.conference_record,"2-0");
  assert.equal(result.rank,1);
  assert.equal(result.standing_state,"ranked");
  assert.equal(result.standings_verified,true);
});

test("calculated rank is withheld when materialized record disagrees with schedule-derived truth", () => {
  const truth=new Map([["football|7a-central-football",{
    standings:[{team_id:"a",school_name:"Alpha",conference_record:"3-0",overall_record:"4-0",rank:1,standings_verified:true}]
  }]]);
  const result=applyStandingsTruthToStatuses([status()],truth)[0];
  assert.equal(result.conference_record,"2-0");
  assert.equal(result.rank,null);
  assert.equal(result.standing_state,"unavailable");
});

test("published evidence can expose missing finals without becoming record truth", () => {
  const result=applyPublishedCompletenessCrossCheck(status({
    conference_games:1,conference_record:"1-0",overall_games:3,overall_record:"3-0"
  }),{
    published_conference_record:"2-0",published_overall_record:"4-0"
  });
  assert.equal(result.conference_record,null);
  assert.equal(result.overall_record,null);
  assert.equal(result.rank,null);
  assert.equal(result.record_verified,false);
  assert.equal(result.record_state,"INCOMPLETE");
  assert.ok(result.record_issues.some(issue=>issue.code==="PUBLISHED_RECORD_EXCEEDS_FINAL_EVIDENCE"));
  assert.ok(result.record_issues.some(issue=>issue.code==="PUBLISHED_CONFERENCE_RECORD_EXCEEDS_FINAL_EVIDENCE"));
});

test("published disagreement at equal game count is contradictory but local record stays authoritative", () => {
  const result=applyPublishedCompletenessCrossCheck(status(),{
    published_conference_record:"1-1",published_overall_record:"3-1"
  });
  assert.equal(result.conference_record,"2-0");
  assert.equal(result.overall_record,"4-0");
  assert.equal(result.record_audit_state,"CONTRADICTORY");
  assert.equal(result.rank,null);
  assert.ok(result.record_issues.some(issue=>issue.code==="PUBLISHED_CONFERENCE_RECORD_CONTRADICTS_FINAL_EVIDENCE"));
});

test("not-started conference remains N/A unless published cross-check proves missing finals", () => {
  const truth=new Map([["football|7a-central-football",{
    standings:[{
      school_name:"Alpha",rank:null,conference_record:null,overall_record:null,
      standing_state:"source-published",standings_verified:false,
      published_conference_record:"2-0",published_overall_record:"2-0",published_rank:1,
      published_cross_check:"source-only"
    }]
  }]]);
  const result=applyStandingsTruthToStatuses([status({
    conference_games:0,conference_record:null,overall_games:0,overall_record:null
  })],truth)[0];
  assert.equal(result.conference_record,null,"published evidence shows the local N/A state is incomplete, not truly not-started");
  assert.equal(result.rank,null);
  assert.equal(result.record_state,"INCOMPLETE");
  assert.equal(result.published_conference_record,"2-0");
});

test("conference standings route parser is exact", () => {
  assert.equal(conferenceStandingsId("/api/v1/conferences/7a-central-football/standings"),"7a-central-football");
  assert.equal(conferenceStandingsId("/api/v1/conferences/7a-central-football"),null);
});
