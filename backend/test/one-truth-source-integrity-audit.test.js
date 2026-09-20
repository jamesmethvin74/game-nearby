import test from "node:test";
import assert from "node:assert/strict";
import { auditOneTruthSourceCompleteness } from "../src/one-truth-source-integrity-audit.js";

function sourceRow(overrides={}) {
  return {
    team_id:"conway-football-2026",
    school_id:"conway",
    school_name:"Conway High School",
    level:"high-school",
    sport:"football",
    gender:"boys",
    season:"2026",
    game_id:"capital-schedule",
    source_id:"conway-football-official",
    source_type:"official-school",
    parser_type:"mascot-media",
    opponent:"Capital High School",
    opponent_school_id:"capital",
    raw_scheduled_at:"2026-09-19T00:00:00.000Z",
    raw_time_known:1,
    raw_status:"SCHEDULED",
    raw_team_score:null,
    raw_opponent_score:null,
    raw_result:null,
    counts_for_record:1,
    home_away:"home",
    conference_game:0,
    canonical_event_id:"ce-capital",
    canonical_scheduled_at:"2026-09-19T00:00:00.000Z",
    canonical_time_known:1,
    canonical_status:"SCHEDULED",
    canonical_home_score:null,
    canonical_away_score:null,
    canonical_home_school_id:"conway",
    canonical_away_school_id:"capital",
    canonical_trust_state:"SINGLE_SOURCE_LIVE",
    conflict_count:0,
    ...overrides
  };
}

function truthRows(overrides={}) {
  const game={
    truth_id:"GAME:conway-football-2026:ce-capital",
    row_type:"GAME",
    team_id:"conway-football-2026",
    school_id:"conway",
    school_name:"Conway High School",
    school_level:"high-school",
    sport:"football",
    gender:"boys",
    season:"2026",
    conference_id:"6a-central",
    conference_name:"6A Central",
    conference_membership_state:"member",
    rank:null,
    overall_wins:1,
    overall_losses:0,
    overall_ties:0,
    conference_wins:0,
    conference_losses:0,
    conference_ties:0,
    scored_finals:1,
    conference_scored_finals:0,
    game_id:"capital-schedule",
    canonical_event_id:"ce-capital",
    canonical_home_school_id:"conway",
    canonical_away_school_id:"capital",
    opponent_school_id:"capital",
    opponent:"Capital High School",
    scheduled_at:"2026-09-19T00:00:00.000Z",
    scheduled_time_known:1,
    home_away:"home",
    conference_game:0,
    counts_for_record:1,
    status:"FINAL",
    team_score:45,
    opponent_score:7,
    result:"W",
    source_id:"conway-football-official",
    source_type:"official-school",
    parser_type:"mascot-media",
    data_trust:"SINGLE_SOURCE_LIVE",
    conflict_count:0,
    ...overrides
  };
  const team={
    ...game,
    truth_id:"TEAM:conway-football-2026",
    row_type:"TEAM",
    game_id:null,
    canonical_event_id:null,
    opponent:null,
    opponent_school_id:null,
    scheduled_at:null,
    status:null,
    team_score:null,
    opponent_score:null,
    result:null,
    source_id:null,
    source_type:null,
    parser_type:null,
    counts_for_record:null
  };
  return [team,game];
}

test("matched result-only FINAL enriches schedule truth and old parser-family filter is quantified",()=>{
  const schedule=[sourceRow()];
  const resultOnly=[sourceRow({
    game_id:"capital-results",
    source_id:"conway-football-2026-official-school-results",
    raw_status:"FINAL",
    raw_team_score:45,
    raw_opponent_score:7,
    raw_result:"W"
  })];
  const audit=auditOneTruthSourceCompleteness(schedule,resultOnly,truthRows());
  assert.equal(audit.summary.result_enrichment_required_games,1);
  assert.equal(audit.summary.result_enrichment_missing_from_truth,0);
  assert.equal(audit.summary.result_only_standalone_truth_rows,0);
  assert.equal(audit.summary.legacy_parser_filter_affected_teams,1);
  assert.equal(audit.summary.legacy_parser_filter_missing_games,1);
  assert.equal(audit.summary.legacy_parser_filter_missing_finals,1);
  assert.equal(audit.summary.teams_with_final_count_mismatch,0);
  assert.equal(audit.clean,true);
});

test("unmatched result-only FINAL is counted as evidence but cannot create truth",()=>{
  const schedule=[sourceRow()];
  const resultOnly=[sourceRow({
    game_id:"fake-result",
    canonical_event_id:null,
    source_id:"conway-football-2026-official-school-results",
    opponent:"Fake Opponent",
    opponent_school_id:"fake-opponent",
    raw_status:"FINAL",
    raw_team_score:99,
    raw_opponent_score:0,
    raw_result:"W"
  })];
  const audit=auditOneTruthSourceCompleteness(schedule,resultOnly,[]);
  assert.equal(audit.summary.unmatched_result_only_final_evidence,1);
  assert.equal(audit.summary.result_enrichment_required_games,0);
  assert.equal(audit.summary.result_only_standalone_truth_rows,0);
});

test("result-only provenance in ONE_TRUTH is blocking",()=>{
  const rows=truthRows({source_id:"conway-football-2026-official-school-results"});
  const audit=auditOneTruthSourceCompleteness([sourceRow()],[],rows);
  assert.equal(audit.summary.result_only_standalone_truth_rows,1);
  assert.equal(audit.clean,false);
  assert.ok(audit.issues.some(value=>value.code==="RESULT_ONLY_SOURCE_CREATED_ONE_TRUTH_GAME"));
});


test("legacy parser simulation does not label unchanged non-legacy source rows as casualties",()=>{
  const schedule=[sourceRow({
    game_id:"sidearm-game",
    source_id:"college-test-sidearm",
    source_type:"official-school",
    parser_type:"sidearm",
    canonical_event_id:null,
    opponent:"Arkansas",
    opponent_school_id:"arkansas",
    raw_status:"FINAL",
    raw_team_score:0,
    raw_opponent_score:9,
    raw_result:"L"
  })];
  const audit=auditOneTruthSourceCompleteness(schedule,[],[]);
  assert.equal(audit.summary.legacy_parser_filter_affected_teams,0);
  assert.equal(audit.summary.legacy_parser_filter_missing_games,0);
  assert.equal(audit.summary.legacy_parser_filter_missing_finals,0);
});
