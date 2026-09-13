import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFootballLiveCalculatedStandings,
  footballConferenceRecordsFromRosterFinals
} from "../src/football-standings-overlay.js";

test("football roster finals build symmetric conference records", () => {
  const records = footballConferenceRecordsFromRosterFinals([
    { home_school_id:"conway", away_school_id:"cabot", home_score:35, away_score:14 },
    { home_school_id:"bryant", away_school_id:"conway", home_score:21, away_score:21 }
  ]);
  assert.deepEqual(records.get("conway"), { wins:1, losses:0, ties:1 });
  assert.deepEqual(records.get("cabot"), { wins:0, losses:1, ties:0 });
  assert.deepEqual(records.get("bryant"), { wins:0, losses:0, ties:1 });
});

test("football live overlay advances exactly one conference result and current overall record", () => {
  const published = {
    conference:{ id:"7a-central", name:"7A Central" },
    standings:[
      { rank:1, school_name:"Conway", conference_record:"0-0", overall_record:"1-1" }
    ]
  };
  const calculated = buildFootballLiveCalculatedStandings(published, [
    {
      team_id:"conway-football",
      normalized_alias:"conway",
      wins:2, losses:1, ties:0,
      conference_wins:1, conference_losses:0, conference_ties:0,
      calculated_at:"2026-09-13T12:00:00.000Z"
    }
  ]);
  assert.equal(calculated.standings[0].overall_record, "2-1");
  assert.equal(calculated.standings[0].conference_record, "1-0");
});

test("football live overlay refuses ambiguous multi-game conference jumps", () => {
  const published = {
    conference:{ id:"7a-central", name:"7A Central" },
    standings:[
      { rank:1, school_name:"Conway", conference_record:"0-0", overall_record:"1-1" }
    ]
  };
  const calculated = buildFootballLiveCalculatedStandings(published, [
    {
      team_id:"conway-football",
      normalized_alias:"conway",
      wins:3, losses:1, ties:0,
      conference_wins:2, conference_losses:0, conference_ties:0,
      calculated_at:"2026-09-13T12:00:00.000Z"
    }
  ]);
  assert.equal(calculated.standings[0].overall_record, "3-1");
  assert.equal(calculated.standings[0].conference_record, "0-0");
});
