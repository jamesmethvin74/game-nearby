import test from "node:test";
import assert from "node:assert/strict";
import { classifyRecordTruthRows } from "../src/record-truth-audit.js";

function row({
  teamId="arkansas-football-2026",
  schoolId="arkansas",
  schoolName="University of Arkansas",
  level="college",
  sport="football",
  gender="men",
  gameId="g1",
  sourceId="arkansas-official",
  opponent="Opponent",
  date="2026-09-05T23:00:00.000Z",
  status="FINAL",
  teamScore=31,
  opponentScore=14,
  result="W",
  storedWins=2,
  storedLosses=0,
  storedTies=0,
  canonicalEventId=null,
  canonicalHomeSchoolId=null,
  canonicalAwaySchoolId=null,
  canonicalHomeScore=null,
  canonicalAwayScore=null,
  sourceSnapshotCount=2,
  sourceStoredCount=2,
  notes=null,
  countsForRecord=1
}={}) {
  return {
    team_id:teamId,school_id:schoolId,school_name:schoolName,level,sport,gender,season:"2026",conference_id:null,
    stored_wins:storedWins,stored_losses:storedLosses,stored_ties:storedTies,
    stored_conference_wins:0,stored_conference_losses:0,stored_conference_ties:0,
    stored_calculated_at:"2026-09-13T12:00:00.000Z",
    game_id:gameId,source_id:sourceId,source_event_key:gameId,opponent,opponent_school_id:null,
    raw_scheduled_at:date,raw_status:status,raw_team_score:teamScore,raw_opponent_score:opponentScore,raw_result:result,
    counts_for_record:countsForRecord,raw_conference_game:0,notes,source_updated_at:"2026-09-13T13:00:00.000Z",
    last_checked_at:"2026-09-13T13:00:00.000Z",game_updated_at:"2026-09-13T13:00:00.000Z",
    canonical_event_id:canonicalEventId,source_type:"official-athletics",parser_type:"sidearm",authority_rank:1,source_priority:1,
    last_successful_fetch_at:"2026-09-13T13:00:00.000Z",source_snapshot_count:sourceSnapshotCount,source_stored_game_count:sourceStoredCount,
    canonical_scheduled_at:canonicalEventId?date:null,canonical_status:canonicalEventId?status:null,
    canonical_home_score:canonicalHomeScore,canonical_away_score:canonicalAwayScore,
    canonical_home_school_id:canonicalHomeSchoolId,canonical_away_school_id:canonicalAwaySchoolId,
    canonical_conference_game:canonicalEventId?0:null,canonical_trust_state:canonicalEventId?"AUTHORITATIVE_LIVE":null,canonical_conflict_count:0,
    standing_overall_record:null,standing_conference_record:null,standing_method:null,standing_calculated_at:null
  };
}

test("statewide audit explains Arkansas orientation bug and stale 2-0 storage", () => {
  const rows=[
    row({gameId:"north-alabama",opponent:"North Alabama",date:"2026-09-05T23:00:00.000Z",result:"W",teamScore:31,opponentScore:14}),
    row({gameId:"utah",opponent:"Utah",date:"2026-09-12T23:00:00.000Z",result:"L",teamScore:43,opponentScore:10})
  ];
  const audit=classifyRecordTruthRows(rows,{now:new Date("2026-09-13T20:00:00.000Z")});
  assert.equal(audit.summary.total_active_teams_with_finals,1);
  assert.equal(audit.summary.contradictory,1);
  assert.equal(audit.summary.orientation_corrections,1);
  assert.equal(audit.summary.unexplained_record_contradictions,0);
  const team=audit.teams[0];
  assert.equal(team.public_record_state,"VERIFIED");
  assert.deepEqual(team.trusted_record,{wins:1,losses:1,ties:0,conference_wins:0,conference_losses:0,conference_ties:0,scored_finals:2});
  assert.ok(team.issues.some(item=>item.code==="EXPLICIT_RESULT_SCORE_ORIENTATION_CONTRADICTION" && item.resolved));
  assert.ok(team.issues.some(item=>item.code==="STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE"));
});

test("stored record with more games than final evidence is incomplete and public record fails closed", () => {
  const audit=classifyRecordTruthRows([
    row({storedWins:3,storedLosses:0,sourceSnapshotCount:1,sourceStoredCount:1})
  ],{now:new Date("2026-09-13T20:00:00.000Z")});
  const team=audit.teams[0];
  assert.equal(team.classification,"INCOMPLETE");
  assert.equal(team.public_record_state,"INCOMPLETE");
  assert.equal(team.trusted_record,null);
  assert.ok(team.issues.some(item=>item.code==="STORED_RECORD_EXCEEDS_FINAL_EVIDENCE"));
});

test("canonical score that contradicts authoritative result is an unexplained contradiction", () => {
  const audit=classifyRecordTruthRows([
    row({
      storedWins:0,storedLosses:1,
      opponent:"Utah",result:"L",teamScore:43,opponentScore:10,
      canonicalEventId:"ce-utah",canonicalHomeSchoolId:"arkansas",canonicalAwaySchoolId:"utah",
      canonicalHomeScore:43,canonicalAwayScore:10,
      sourceSnapshotCount:1,sourceStoredCount:1
    })
  ],{now:new Date("2026-09-13T20:00:00.000Z")});
  const team=audit.teams[0];
  assert.equal(team.classification,"CONTRADICTORY");
  assert.equal(team.unexplained_issue_count>0,true);
  assert.ok(team.issues.some(item=>item.code==="CANONICAL_EVENT_RESULT_CONTRADICTION" && item.severity==="blocking"));
});

test("source snapshot larger than stored source rows is a completeness failure", () => {
  const audit=classifyRecordTruthRows([
    row({storedWins:1,storedLosses:0,sourceSnapshotCount:2,sourceStoredCount:1})
  ],{now:new Date("2026-09-13T20:00:00.000Z")});
  const team=audit.teams[0];
  assert.equal(team.classification,"INCOMPLETE");
  assert.ok(team.issues.some(item=>item.code==="SOURCE_COMPLETENESS_GAP"));
});

test("duplicate matching finals are detected but count once", () => {
  const rows=[
    row({gameId:"a",sourceId:"school",storedWins:1,sourceSnapshotCount:1,sourceStoredCount:1}),
    row({gameId:"b",sourceId:"conference",storedWins:1,sourceSnapshotCount:1,sourceStoredCount:1})
  ];
  const audit=classifyRecordTruthRows(rows,{now:new Date("2026-09-13T20:00:00.000Z")});
  const team=audit.teams[0];
  assert.equal(team.derived_record.scored_finals,1);
  assert.equal(team.derived_record.wins,1);
  assert.ok(team.issues.some(item=>item.code==="DUPLICATE_FINAL_OBSERVATIONS"));
});

test("non-counting high-school scrimmage does not enter statewide record truth", () => {
  const audit=classifyRecordTruthRows([
    row({
      teamId:"conway-football-2026",schoolId:"conway",schoolName:"Conway High School",level:"high-school",gender:"boys",
      gameId:"scrimmage",opponent:"Scrimmage Opponent",notes:"Scrimmage",countsForRecord:0,
      storedWins:0,storedLosses:0,sourceSnapshotCount:1,sourceStoredCount:1
    })
  ],{now:new Date("2026-09-13T20:00:00.000Z")});
  assert.equal(audit.teams[0].derived_record.scored_finals,0);
  assert.equal(audit.teams[0].derived_record.wins,0);
  assert.equal(audit.teams[0].derived_record.losses,0);
});
