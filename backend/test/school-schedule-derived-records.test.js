import test from "node:test";
import assert from "node:assert/strict";
import { attachScheduleDerivedRecords, dedupeSchoolScheduleRows } from "../src/m4-public-worker.js";

function game(overrides = {}) {
  return {
    reporting_team_id: "conway-football-2026",
    team_id: "conway-football-2026",
    school_id: "conway",
    sport: "football",
    gender: "boys",
    season: "2026",
    status: "FINAL",
    counts_for_record: 1,
    conference_game: 0,
    wins: null,
    losses: null,
    ties: null,
    conference_wins: null,
    conference_losses: null,
    conference_ties: null,
    ...overrides
  };
}

test("team detail derives a record from the scored finals already visible in its schedule", () => {
  const rows = [
    game({ id:"capital", scheduled_at:"2026-08-29T00:00:00.000Z", opponent:"Capital High School (MO)", team_score:45, opponent_score:7 }),
    game({ id:"bentonville", scheduled_at:"2026-09-05T00:00:00.000Z", opponent:"Bentonville High School", team_score:14, opponent_score:20 }),
    game({ id:"marion", scheduled_at:"2026-09-12T00:00:00.000Z", opponent:"Marion High School", team_score:48, opponent_score:0 }),
    game({ id:"future", scheduled_at:"2026-09-26T00:00:00.000Z", opponent:"Northside", status:"SCHEDULED", team_score:null, opponent_score:null })
  ];

  const result = attachScheduleDerivedRecords(rows);
  for (const row of result) {
    assert.equal(row.wins, 2);
    assert.equal(row.losses, 1);
    assert.equal(row.ties, 0);
    assert.equal(row.conference_wins, 0);
    assert.equal(row.conference_losses, 0);
    assert.equal(row.conference_ties, 0);
    assert.equal(row.record_source, "normalized-final-games");
    assert.equal(row.record_verified, true);
  }
});

test("legacy bare zero flags cannot hide ordinary scored finals statewide", () => {
  const rows = [
    game({ id:"searcy", scheduled_at:"2026-08-29T00:00:00.000Z", opponent:"Searcy High School", team_score:13, opponent_score:54, counts_for_record:0 }),
    game({ id:"newport", scheduled_at:"2026-09-05T00:00:00.000Z", opponent:"The Academies At Newport High School", team_score:16, opponent_score:13, counts_for_record:0 })
  ];

  const result = attachScheduleDerivedRecords(rows);
  assert.equal(result[0].wins, 1);
  assert.equal(result[0].losses, 1);
  assert.equal(result[0].record_source, "normalized-final-games");
  assert.equal(result[0].record_verified, true);
});

test("named non-record games stay excluded while ordinary legacy finals count", () => {
  const rows = [
    game({ id:"benefit", scheduled_at:"2026-08-19T00:00:00.000Z", opponent:"Morrilton Benefit Game", notes:"Benefit Game", team_score:21, opponent_score:14, counts_for_record:0 }),
    game({ id:"capital", scheduled_at:"2026-08-29T00:00:00.000Z", opponent:"Capital High School (MO)", team_score:45, opponent_score:7, counts_for_record:0 })
  ];

  const result = attachScheduleDerivedRecords(rows);
  assert.equal(result[0].wins, 1);
  assert.equal(result[0].losses, 0);
});

test("certified DragonFly zero remains an explicit non-record decision", () => {
  const rows = [
    game({
      id:"df-exhibition",
      scheduled_at:"2026-09-05T00:00:00.000Z",
      opponent:"Opponent High School",
      team_score:2,
      opponent_score:1,
      counts_for_record:0,
      parser_type:"dragonfly-public"
    })
  ];

  const result = attachScheduleDerivedRecords(rows);
  assert.equal(result[0].wins, null);
  assert.equal(result[0].losses, null);
  assert.equal(result[0].record_source, "unverified");
  assert.equal(result[0].record_state, "NO_RECORD_EVIDENCE");
  assert.equal(result[0].record_verified, false);
});

test("high-school basketball before the official 2026-27 boundary stays out of records", () => {
  const rows = [
    game({
      reporting_team_id:"sample-basketball-boys-2026",
      team_id:"sample-basketball-boys-2026",
      school_id:"sample",
      sport:"basketball",
      gender:"boys",
      id:"preseason",
      scheduled_at:"2026-11-04T01:00:00.000Z",
      opponent:"Opponent High School",
      team_score:70,
      opponent_score:60,
      counts_for_record:0
    })
  ];

  const result = attachScheduleDerivedRecords(rows);
  assert.equal(result[0].wins, null);
  assert.equal(result[0].losses, null);
  assert.equal(result[0].record_source, "unverified");
  assert.equal(result[0].record_state, "NO_RECORD_EVIDENCE");
  assert.equal(result[0].record_verified, false);
});

test("a richer stored record marks visible schedule evidence incomplete instead of overriding game truth", () => {
  const rows = [
    game({
      id:"capital",
      scheduled_at:"2026-08-29T00:00:00.000Z",
      opponent:"Capital High School (MO)",
      team_score:45,
      opponent_score:7,
      wins:3,
      losses:1,
      ties:0,
      conference_wins:1,
      conference_losses:0,
      conference_ties:0
    })
  ];

  const result = attachScheduleDerivedRecords(rows);
  assert.equal(result[0].wins, null);
  assert.equal(result[0].losses, null);
  assert.equal(result[0].record_source, "unverified");
  assert.equal(result[0].record_state, "INCOMPLETE");
  assert.equal(result[0].record_verified, false);
  assert.ok(result[0].record_issues.some(issue => issue.code === "STORED_RECORD_EXCEEDS_FINAL_EVIDENCE"));
});

test("no scored finals does not fabricate a 0-0 record when no record exists", () => {
  const rows = [
    game({ id:"future", scheduled_at:"2026-09-26T00:00:00.000Z", opponent:"Northside", status:"SCHEDULED", team_score:null, opponent_score:null })
  ];

  const result = attachScheduleDerivedRecords(rows);
  assert.equal(result[0].wins, null);
  assert.equal(result[0].losses, null);
  assert.equal(result[0].record_source, "unverified");
  assert.equal(result[0].record_state, "NO_RECORD_EVIDENCE");
  assert.equal(result[0].record_verified, false);
});


test("school schedule collapses exact volleyball duplicates across split canonical ids",()=>{
  const rows=[
    game({
      id:"benton-a",
      reporting_team_id:"bryant-volleyball-2026",
      team_id:"bryant-volleyball-2026",
      school_id:"bryant",
      sport:"volleyball",
      gender:"girls",
      canonical_event_id:"ce-benton-a",
      scheduled_at:"2026-08-27T23:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Benton High School",
      opponent_school_id:"benton",
      status:"FINAL",
      team_score:1,
      opponent_score:3,
      source_type:"official-conference",
      parser_type:"dragonfly-public"
    }),
    game({
      id:"benton-b",
      reporting_team_id:"bryant-volleyball-2026",
      team_id:"bryant-volleyball-2026",
      school_id:"bryant",
      sport:"volleyball",
      gender:"girls",
      canonical_event_id:"ce-benton-b",
      scheduled_at:"2026-08-27T23:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Benton High School",
      opponent_school_id:"benton",
      status:"FINAL",
      team_score:1,
      opponent_score:3,
      source_type:"official-school",
      parser_type:"mascot-media"
    })
  ];
  const result=dedupeSchoolScheduleRows(rows,"bryant");
  assert.equal(result.length,1);
  assert.equal(result[0].opponent,"Benton High School");
  assert.equal(result[0].schedule_observation_count,2);
});

test("school schedule enforces one displayed football contest per local date",()=>{
  const rows=[
    game({
      id:"benton-football-a",
      reporting_team_id:"bryant-football-2026",
      team_id:"bryant-football-2026",
      school_id:"bryant",
      sport:"football",
      gender:"boys",
      canonical_event_id:"ce-football-a",
      scheduled_at:"2026-08-29T00:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Benton High School",
      opponent_school_id:"benton",
      status:"FINAL",
      team_score:42,
      opponent_score:43,
      source_type:"official-conference",
      parser_type:"dragonfly-public"
    }),
    game({
      id:"benton-football-b",
      reporting_team_id:"bryant-football-2026",
      team_id:"bryant-football-2026",
      school_id:"bryant",
      sport:"football",
      gender:"boys",
      canonical_event_id:"ce-football-b",
      scheduled_at:"2026-08-29T00:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Benton High School",
      opponent_school_id:"legacy-benton",
      status:"FINAL",
      team_score:42,
      opponent_score:43,
      source_type:"official-school",
      parser_type:"mascot-media"
    })
  ];
  const result=dedupeSchoolScheduleRows(rows,"bryant");
  assert.equal(result.length,1);
  assert.equal(result[0].team_score,42);
  assert.equal(result[0].opponent_score,43);
});

test("school schedule keeps legitimate same-day volleyball matches distinct",()=>{
  const rows=[
    game({
      id:"pool-a",
      reporting_team_id:"sample-volleyball-2026",
      team_id:"sample-volleyball-2026",
      school_id:"sample",
      sport:"volleyball",
      gender:"girls",
      scheduled_at:"2026-09-19T15:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Nixa High School",
      opponent_school_id:"nixa",
      status:"FINAL",
      team_score:2,
      opponent_score:0
    }),
    game({
      id:"pool-b",
      reporting_team_id:"sample-volleyball-2026",
      team_id:"sample-volleyball-2026",
      school_id:"sample",
      sport:"volleyball",
      gender:"girls",
      scheduled_at:"2026-09-19T19:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Ozark High School",
      opponent_school_id:"ozark",
      status:"FINAL",
      team_score:2,
      opponent_score:1
    })
  ];
  assert.equal(dedupeSchoolScheduleRows(rows,"sample").length,2);
});
