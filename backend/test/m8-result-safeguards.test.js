import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFinalResultTruth } from "../src/final-result-truth.js";
import { classifyRecordTruthRows } from "../src/record-truth-audit.js";

const ambiguousContestId="68e6ca03-cd54-40c8-9bff-4abd5d8871f6";

function baseRow(overrides={}) {
  return {
    team_id:"north-little-rock-volleyball-2026",
    school_id:"north-little-rock",
    school_name:"North Little Rock High School",
    level:"high-school",
    sport:"volleyball",
    gender:"girls",
    season:"2026",
    conference_id:null,
    stored_wins:0,
    stored_losses:1,
    stored_ties:0,
    stored_conference_wins:0,
    stored_conference_losses:0,
    stored_conference_ties:0,
    source_snapshot_count:1,
    source_stored_game_count:1,
    counts_for_record:1,
    raw_conference_game:0,
    standing_overall_record:null,
    standing_conference_record:null,
    standing_method:null,
    ...overrides
  };
}

test("known provider self-contradiction is quarantined while ordinary 1-1 volleyball ties remain verified",()=>{
  const quarantined=evaluateFinalResultTruth({
    sport:"volleyball",
    status:"FINAL",
    result:"T",
    team_score:1,
    opponent_score:1,
    source_event_key:`native:${ambiguousContestId}`
  });
  assert.equal(quarantined.state,"QUARANTINED");
  assert.equal(quarantined.reason,"SOURCE_RESULT_AMBIGUITY");

  const ordinary=evaluateFinalResultTruth({
    sport:"volleyball",
    status:"FINAL",
    result:"T",
    team_score:1,
    opponent_score:1,
    source_event_key:"native:ordinary-pool-play-draw"
  });
  assert.equal(ordinary.state,"VERIFIED");
  assert.equal(ordinary.row.result,"T");
});

test("verified canonical final supersedes a stale duplicate T 0-0 placeholder without hiding distinct rematches",()=>{
  const scheduled="2026-08-27T23:00:00.000Z";
  const rows=[
    baseRow({
      game_id:"stale-mascot-placeholder",
      source_id:"north-little-rock-official-school-results",
      source_event_key:"stale-placeholder",
      source_type:"official-school",
      parser_type:"mascot",
      opponent:"Lakeside High School",
      opponent_school_id:"lakeside",
      raw_scheduled_at:scheduled,
      raw_status:"FINAL",
      raw_team_score:0,
      raw_opponent_score:0,
      raw_result:"T",
      canonical_event_id:null
    }),
    baseRow({
      game_id:"verified-canonical-observation",
      source_id:"maxpreps-volleyball-results:north-little-rock-volleyball-2026",
      source_event_key:"native:lakeside-nlr-final",
      source_type:"secondary",
      parser_type:"maxpreps-scores",
      opponent:"Lakeside High School",
      opponent_school_id:"lakeside",
      raw_scheduled_at:scheduled,
      raw_status:"FINAL",
      raw_team_score:1,
      raw_opponent_score:3,
      raw_result:"L",
      canonical_event_id:"ce:lakeside-nlr",
      canonical_scheduled_at:scheduled,
      canonical_status:"FINAL",
      canonical_home_school_id:"lakeside",
      canonical_away_school_id:"north-little-rock",
      canonical_home_score:3,
      canonical_away_score:1,
      canonical_conference_game:0,
      canonical_trust_state:"CORROBORATED"
    })
  ];

  const audit=classifyRecordTruthRows(rows,{now:new Date("2026-09-14T18:41:47.702Z")});
  const team=audit.teams[0];
  assert.equal(team.unresolved_finals,0);
  assert.equal(team.classification,"VERIFIED");
  assert.deepEqual(team.derived_record,{wins:0,losses:1,ties:0,conference_wins:0,conference_losses:0,conference_ties:0,scored_finals:1});
  assert.equal(team.issues.some(issue=>issue.code==="FINAL_MISSING_SCORE" && issue.severity==="blocking"),false);
  assert.equal(team.issues.some(issue=>issue.code==="SUPERSEDED_UNRESOLVED_FINAL_OBSERVATION" && issue.resolved===true),true);
});

test("ambiguous provider final is incomplete and never counted as trustworthy record evidence",()=>{
  const row=baseRow({
    team_id:"brookland-volleyball-2026",
    school_id:"brookland",
    school_name:"Brookland High School",
    stored_wins:0,
    stored_losses:0,
    stored_ties:1,
    game_id:"brookland-batesville",
    source_id:"maxpreps-volleyball-results:brookland-volleyball-2026",
    source_event_key:`native:${ambiguousContestId}`,
    source_type:"secondary",
    parser_type:"maxpreps-scores",
    opponent:"Batesville High School",
    opponent_school_id:"batesville",
    raw_scheduled_at:"2026-08-29T17:00:00.000Z",
    raw_status:"FINAL",
    raw_team_score:1,
    raw_opponent_score:1,
    raw_result:"T",
    canonical_event_id:null
  });

  const audit=classifyRecordTruthRows([row],{now:new Date("2026-09-14T18:41:47.702Z")});
  const team=audit.teams[0];
  assert.equal(team.classification,"INCOMPLETE");
  assert.equal(team.public_record_verified,false);
  assert.equal(team.evidence_games,0);
  assert.equal(team.issues.some(issue=>issue.code==="SOURCE_RESULT_AMBIGUITY" && issue.severity==="blocking"),true);
});
