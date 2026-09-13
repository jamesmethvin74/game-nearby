import test from "node:test";
import assert from "node:assert/strict";
import { attachScheduleDerivedRecords } from "../src/m4-public-worker.js";

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
    assert.equal(row.record_source, "schedule-derived");
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
  assert.equal(result[0].record_source, "schedule-derived");
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
  assert.equal(result[0].record_source, undefined);
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
  assert.equal(result[0].record_source, undefined);
});

test("a richer stored record is preserved when the visible schedule snapshot has fewer scored finals", () => {
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
  assert.equal(result[0].wins, 3);
  assert.equal(result[0].losses, 1);
  assert.equal(result[0].record_source, undefined);
});

test("no scored finals does not fabricate a 0-0 record when no record exists", () => {
  const rows = [
    game({ id:"future", scheduled_at:"2026-09-26T00:00:00.000Z", opponent:"Northside", status:"SCHEDULED", team_score:null, opponent_score:null })
  ];

  const result = attachScheduleDerivedRecords(rows);
  assert.equal(result[0].wins, null);
  assert.equal(result[0].losses, null);
  assert.equal(result[0].record_source, undefined);
});
