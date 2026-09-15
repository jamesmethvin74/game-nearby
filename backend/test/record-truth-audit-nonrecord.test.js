import test from "node:test";
import assert from "node:assert/strict";
import { classifyRecordTruthRows } from "../src/record-truth-audit.js";

function row({
  gameId,
  opponent,
  status,
  notes=null,
  venue=null,
  locationText=null,
  teamScore=null,
  opponentScore=null,
  result=null,
  date="2026-08-20T17:00:00.000Z"
}) {
  return {
    team_id:"mountain-home-volleyball-2026",
    school_id:"mountain-home",
    school_name:"Mountain Home High School",
    level:"high-school",
    sport:"volleyball",
    gender:"girls",
    season:"2026",
    conference_id:null,
    stored_wins:0,
    stored_losses:0,
    stored_ties:0,
    stored_conference_wins:0,
    stored_conference_losses:0,
    stored_conference_ties:0,
    game_id:gameId,
    source_id:"mountain-home-official-school-results",
    source_event_key:gameId,
    opponent,
    opponent_school_id:null,
    venue,
    location_text:locationText,
    raw_scheduled_at:date,
    raw_status:status,
    raw_team_score:teamScore,
    raw_opponent_score:opponentScore,
    raw_result:result,
    counts_for_record:1,
    raw_conference_game:0,
    notes,
    source_type:"official-school",
    parser_type:"mascot",
    source_snapshot_count:1,
    source_stored_game_count:1,
    canonical_event_id:null,
    standing_overall_record:null,
    standing_conference_record:null,
    standing_method:null
  };
}

test("jamboree FINAL without scores is non-record and cannot create an unresolved blocker", () => {
  const audit=classifyRecordTruthRows([
    row({gameId:"conway-jamboree",opponent:"Conway Jamboree",status:"FINAL",result:"T"})
  ],{now:new Date("2026-09-14T18:41:47.702Z")});

  const team=audit.teams[0];
  assert.equal(team.unresolved_finals,0);
  assert.equal(team.classification,"VERIFIED");
  assert.equal(team.issues.some(issue=>issue.code==="FINAL_MISSING_SCORE"),false);
  assert.equal(audit.summary.unresolved,0);
});

test("non-record descriptor in venue suppresses past-due blockers even when stored flag is countable", () => {
  const audit=classifyRecordTruthRows([
    row({gameId:"preseason",opponent:"Conway High School",venue:"Preseason Scrimmage",status:"SCHEDULED"})
  ],{now:new Date("2026-09-14T18:41:47.702Z")});

  const team=audit.teams[0];
  assert.equal(team.classification,"VERIFIED");
  assert.equal(team.issues.some(issue=>issue.code==="PAST_DUE_NONTERMINAL"),false);
  assert.equal(audit.summary.incomplete,0);
});
