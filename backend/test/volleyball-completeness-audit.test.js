import assert from "node:assert/strict";
import test from "node:test";
import { buildVolleyballCompletenessAudit } from "../src/volleyball-completeness-audit.js";

function team(overrides={}) {
  return {
    team_id:"conway-volleyball-2026",school_id:"conway",school_name:"Conway",
    raw_school_name:"Conway High School",location_matched_name:"Conway",
    conference_id:"6a-central-volleyball",conference_name:"6A Central",
    record_exists:1,wins:1,losses:0,ties:0,conference_wins:1,conference_losses:0,conference_ties:0,
    source_count:2,enabled_source_count:1,standings_method:"calculated",
    ...overrides
  };
}

function canonical(overrides={}) {
  return {
    canonical_event_id:"vb-conway-southwest-2026-09-03",
    participant_a_school_id:"conway",participant_b_school_id:"lr-southwest",
    home_school_id:"conway",away_school_id:"lr-southwest",
    scheduled_at:"2026-09-03T18:00:00-05:00",scheduled_time_known:1,
    status:"FINAL",home_score:3,away_score:0,conference_game:0,
    latitude:35.0887,longitude:-92.4421,selected_source_id:"dragonfly",
    trust_state:"AUTHORITATIVE_LIVE",conflict_count:0,unresolved_conflict_count:0,
    member_observation_count:2,reporting_team_count:2,
    reporting_team_ids:"conway-volleyball-2026,lr-southwest-volleyball-2026",eligible_member_count:2,
    ...overrides
  };
}

function candidate(teamId,schoolId,opponentId,opponent,teamScore,opponentScore) {
  return {
    team_id:teamId,school_id:schoolId,sport:"volleyball",gender:"girls",season:"2026",
    canonical_event_id:"vb-conway-southwest-2026-09-03",opponent_school_id:opponentId,opponent,
    scheduled_at:"2026-09-03T18:00:00-05:00",status:"FINAL",
    team_score:teamScore,opponent_score:opponentScore,counts_for_record:1,conference_game:1,
    source_type:"official-conference",parser_type:"dragonfly-public",data_trust:"AUTHORITATIVE_LIVE"
  };
}

const southwest=team({
  team_id:"lr-southwest-volleyball-2026",school_id:"lr-southwest",school_name:"Little Rock Southwest",
  raw_school_name:"Little Rock Southwest High School",location_matched_name:"Little Rock Southwest",
  wins:0,losses:1,conference_wins:0,conference_losses:1
});

const published={
  conferences:[{
    id:"6a-central",name:"6A Central",
    standings:[
      {school_name:"Conway",overall_record:"1-0",conference_record:"1-0"},
      {school_name:"Little Rock Southwest",overall_record:"0-1",conference_record:"0-1"}
    ]
  }],failures:[]
};

const maxFinal={
  contestId:"mp-1",localDate:"2026-09-03",sourceUrl:"https://example.test/final",
  home:{name:"Conway",score:3},away:{name:"Little Rock Southwest",score:0},
  homeTeam:{team_id:"conway-volleyball-2026",school_id:"conway",school_name:"Conway"},
  awayTeam:{team_id:"lr-southwest-volleyball-2026",school_id:"lr-southwest",school_name:"Little Rock Southwest"}
};

test("clean statewide slice reconciles schedule, records, membership, standings, and external final",()=>{
  const result=buildVolleyballCompletenessAudit({
    teams:[team(),southwest],
    canonicals:[canonical()],
    candidates:[
      candidate("conway-volleyball-2026","conway","lr-southwest","Little Rock Southwest",3,0),
      candidate("lr-southwest-volleyball-2026","lr-southwest","conway","Conway",0,3)
    ],
    published,
    maxPreps:{matched:[maxFinal],ambiguousFinals:[]},
    generatedAt:"2026-09-07T23:00:00.000Z"
  });
  assert.equal(result.summary.active_arkansas_varsity_volleyball_teams,2);
  assert.equal(result.summary.teams_with_schedules,2);
  assert.equal(result.summary.teams_with_completed_games,2);
  assert.equal(result.summary.teams_with_conference_membership,2);
  assert.equal(result.summary.teams_represented_in_published_standings,2);
  assert.equal(result.summary.teams_overall_record_agrees_with_published,2);
  assert.equal(result.summary.teams_conference_record_agrees_with_published,2);
  assert.equal(result.summary.conferences_with_complete_local_membership,1);
  assert.equal(result.summary.exception_count,0);
});

test("classifies stale external final, missing membership, record drift, coordinate and attachment gaps",()=>{
  const conway=team({
    conference_id:null,conference_name:null,
    wins:0,losses:0,conference_wins:0,conference_losses:0,
    standings_method:null
  });
  const scheduled=canonical({
    status:"SCHEDULED",home_score:null,away_score:null,latitude:null,longitude:null,
    member_observation_count:1,reporting_team_count:1,
    reporting_team_ids:"conway-volleyball-2026",eligible_member_count:1
  });
  const scheduledCandidate={
    ...candidate("conway-volleyball-2026","conway","lr-southwest","Little Rock Southwest",null,null),
    status:"SCHEDULED",team_score:null,opponent_score:null,conference_game:0
  };
  const result=buildVolleyballCompletenessAudit({
    teams:[conway,southwest],canonicals:[scheduled],candidates:[scheduledCandidate],published,
    maxPreps:{matched:[maxFinal],ambiguousFinals:[]}
  });
  const types=new Set(Object.keys(result.exceptions_by_deficiency));
  assert(types.has("missing_conference_membership"));
  assert(types.has("stale_scheduled_external_final"));
  assert(types.has("overall_record_authority_mismatch"));
  assert(types.has("conference_record_authority_mismatch"));
  assert.equal(result.exceptions_by_deficiency.stale_scheduled_external_final.count,2);
});

test("flags a published final when exactly one local team matches and the opponent is unresolved",()=>{
  const external={
    contestId:"mp-external",localDate:"2026-09-05",sourceUrl:"https://example.test/external",
    home:{name:"Conway",score:2},away:{name:"Out Of State Academy",score:1}
  };
  const result=buildVolleyballCompletenessAudit({
    teams:[team()],canonicals:[],candidates:[],published:null,
    maxPreps:{matched:[],ambiguousFinals:[external]}
  });
  assert.equal(result.exceptions_by_deficiency.authority_final_unmatched_opponent.count,1);
  assert.equal(result.exceptions_by_deficiency.authority_final_unmatched_opponent.exceptions[0].team_id,"conway-volleyball-2026");
  assert.match(result.exceptions_by_deficiency.authority_final_unmatched_opponent.exceptions[0].recommended_repair,/one-sided local team finals/);
});
