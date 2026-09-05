import test from "node:test";
import assert from "node:assert/strict";
import { findMissingReciprocalSides, reverseHomeAway } from "../src/hootens-team-side-results.js";

test("reverseHomeAway mirrors local team perspective", () => {
  assert.equal(reverseHomeAway("home"),"away");
  assert.equal(reverseHomeAway("away"),"home");
  assert.equal(reverseHomeAway("neutral"),"neutral");
  assert.equal(reverseHomeAway("unknown"),"unknown");
});

test("findMissingReciprocalSides repairs only the missing local side", () => {
  const sourceRows=[{
    reporting_school_id:"blevins",
    reporting_school_name:"Blevins",
    opponent_school_id:"guy-perkins",
    team_score:12,
    opponent_score:28,
    scheduled_at:"2026-09-03T12:00:00.000Z"
  }];
  const oneSided=[{
    school_id:"blevins",
    opponent_school_id:"guy-perkins",
    opponent:"Guy-Perkins",
    team_score:12,
    opponent_score:28,
    scheduled_at:"2026-09-03T12:00:00.000Z"
  }];
  assert.equal(findMissingReciprocalSides(sourceRows,oneSided).length,1);

  const complete=[...oneSided,{
    school_id:"guy-perkins",
    opponent_school_id:"blevins",
    opponent:"Blevins",
    team_score:28,
    opponent_score:12,
    scheduled_at:"2026-09-03T12:00:00.000Z"
  }];
  assert.equal(findMissingReciprocalSides(sourceRows,complete).length,0);
});

test("findMissingReciprocalSides accepts normalized opponent text when opponent_school_id is null", () => {
  const sourceRows=[{
    reporting_school_id:"guy-perkins",
    reporting_school_name:"Guy-Perkins",
    opponent_school_id:"blevins",
    team_score:28,
    opponent_score:12,
    scheduled_at:"2026-09-03T12:00:00.000Z"
  }];
  const reciprocal=[{
    school_id:"blevins",
    opponent_school_id:null,
    opponent:"Guy Perkins",
    team_score:12,
    opponent_score:28,
    scheduled_at:"2026-09-03T12:00:00.000Z"
  }];
  assert.equal(findMissingReciprocalSides(sourceRows,reciprocal).length,0);
});
