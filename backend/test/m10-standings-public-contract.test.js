import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPublishedCompletenessCrossCheck,
  applyStandingsTruthToStatuses,
  conferenceStandingsId
} from "../src/conference-membership-public-worker.js";
import {
  calculatedResultEvidenceState,
  loadDurableConferenceCohortState
} from "../src/standings-truth.js";

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

test("M10 membership completeness comes from durable M9 truth, not conferences.coverage_complete", async () => {
  const env={
    DB:{
      prepare(sql){
        assert.match(sql,/conference_memberships/);
        assert.doesNotMatch(sql,/coverage_complete/);
        return {
          bind(){ return this; },
          async first(){
            return {expected_members:8,explicit_members:8,unknown_members:0,invalid_memberships:0};
          }
        };
      }
    }
  };
  const state=await loadDurableConferenceCohortState(env,{
    sport:"football",conferenceId:"7a-central-football",season:"2026"
  });
  assert.equal(state.expected_members,8);
  assert.equal(state.explicit_members,8);
  assert.equal(state.membership_complete,true);
  assert.equal(state.coverage_complete,true);
});

test("M10 result evidence exposes contradictions without letting published rows overwrite canonical truth", () => {
  const calculated={standings:[
    {school_name:"Alpha",conference_record:"2-0",overall_record:"4-0"},
    {school_name:"Beta",conference_record:"1-1",overall_record:"3-1"}
  ]};
  const verified=calculatedResultEvidenceState(calculated,{standings:[
    {school_name:"Alpha High School",conference_record:"2-0",overall_record:"4-0"},
    {school_name:"Beta High School",conference_record:"1-1",overall_record:"3-1"}
  ]},{expectedMembers:2});
  assert.equal(verified.result_evidence_complete,true);
  assert.equal(verified.unexplained_record_contradictions,0);

  const contradictory=calculatedResultEvidenceState(calculated,{standings:[
    {school_name:"Alpha",conference_record:"1-1",overall_record:"3-1"},
    {school_name:"Beta",conference_record:"1-1",overall_record:"3-1"}
  ]},{expectedMembers:2});
  assert.equal(contradictory.result_evidence_complete,false);
  assert.equal(contradictory.unexplained_record_contradictions,1);
});

test("conference standings route parser is exact", () => {
  assert.equal(conferenceStandingsId("/api/v1/conferences/7a-central-football/standings"),"7a-central-football");
  assert.equal(conferenceStandingsId("/api/v1/conferences/7a-central-football"),null);
});
