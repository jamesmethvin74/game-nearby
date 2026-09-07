import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMascotRows, parseResult } from "../src/parser-core.js";
import { applySchoolDisplayNames, recordFromScheduleRows } from "../src/schedule-response-normalizer.js";

test("explicit school-feed win orients a reversed numeric volleyball score", () => {
  assert.deepEqual(parseResult("W 1 - 2"), {
    status:"FINAL",
    teamScore:2,
    opponentScore:1,
    result:"W"
  });

  const [game] = normalizeMascotRows([{
    cells:["Aug 29 10:00 AM VS Little Rock Christian Buzz Bolding Arena Conway, AR","Little Rock Christian","W 1 - 2",""],
    full:"Aug 29 10:00 AM VS Little Rock Christian Buzz Bolding Arena Conway, AR W 1 - 2"
  }], {
    season:"2026",
    sport:"volleyball",
    timezone:"America/Chicago",
    home_venue:"Buzz Bolding Arena",
    home_latitude:35.088,
    home_longitude:-92.442
  });

  assert.equal(game.status,"FINAL");
  assert.equal(game.result,"W");
  assert.equal(game.teamScore,2);
  assert.equal(game.opponentScore,1);
});

test("existing stored W/L rows remain correct before they are reingested", () => {
  const stored = applySchoolDisplayNames({
    school_id:"conway",
    sport:"volleyball",
    gender:"girls",
    scheduled_at:"2026-08-29T15:00:00.000Z",
    opponent:"Little Rock Christian",
    status:"FINAL",
    team_score:1,
    opponent_score:2,
    result:"W",
    counts_for_record:1,
    conference_game:0,
    source_type:"official-school",
    parser_type:"mascot-media"
  });

  assert.equal(stored.team_score,2);
  assert.equal(stored.opponent_score,1);
  const record = recordFromScheduleRows([stored], { reportingSchoolId:"conway" });
  assert.deepEqual(record, {
    wins:1,
    losses:0,
    ties:0,
    conference_wins:0,
    conference_losses:0,
    conference_ties:0,
    scored_finals:1
  });
});

test("explicit loss is also honored when a provider reverses the numeric sides", () => {
  const parsed = parseResult("L 3-1");
  assert.equal(parsed.result,"L");
  assert.equal(parsed.teamScore,1);
  assert.equal(parsed.opponentScore,3);
});
