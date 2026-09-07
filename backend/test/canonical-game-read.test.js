import test from "node:test";
import assert from "node:assert/strict";
import { finiteNumber, haversineMiles, resolvedNearbyGame } from "../src/canonical-game-read-worker.js";

test("canonical nearby row uses canonical venue coordinates and result", () => {
  const row={
    id:"raw",canonical_event_id:"ce:1",school_id:"away",opponent:"Old opponent",
    latitude:null,longitude:null,venue:"",location_text:"",status:"SCHEDULED",team_score:null,opponent_score:null,
    conference_game:0,
    canonical_home_school_id:"home",canonical_away_school_id:"away",
    canonical_home_name:"Home School",canonical_away_name:"Away School",
    canonical_scheduled_at:"2026-09-03T23:00:00.000Z",canonical_time_known:1,
    canonical_venue:"Home Gym",canonical_location_text:"Home Gym, Arkansas",
    canonical_latitude:34.75,canonical_longitude:-92.28,
    canonical_status:"FINAL",canonical_home_score:0,canonical_away_score:3,
    canonical_conference_game:1,data_trust:"CORROBORATED",conflict_count:0
  };
  const game=resolvedNearbyGame(row);
  assert.equal(game.opponent,"Home School");
  assert.equal(game.latitude,34.75);
  assert.equal(game.longitude,-92.28);
  assert.equal(game.venue,"Home Gym");
  assert.equal(game.team_score,3);
  assert.equal(game.opponent_score,0);
  assert.equal(game.result,"W");
  assert.equal(game.conference_game,1);
});

test("nearby numeric helpers reject missing values instead of treating them as zero", () => {
  assert.equal(finiteNumber(null),null);
  assert.equal(finiteNumber(""),null);
  assert.equal(finiteNumber("34.75"),34.75);
  assert.ok(haversineMiles(35.09,-92.44,35.10,-92.45) < 2);
});
