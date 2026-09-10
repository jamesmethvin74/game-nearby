import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDesiredFinal, planM7VolleyballDateFinals } from "../src/m7-volleyball-date-final-plan.js";

test("M7 date-level final planner rejects dates outside the fixed 2026 season shape before touching D1",async()=>{
  await assert.rejects(()=>planM7VolleyballDateFinals({},"2025-08-18"),/must be YYYY-MM-DD in 2026/);
  await assert.rejects(()=>planM7VolleyballDateFinals({},"not-a-date"),/must be YYYY-MM-DD in 2026/);
});

test("canonical final scores follow DragonFly home-away orientation, not secondary display order",()=>{
  const target={home:{school_id:"booneville",score:3},away:{school_id:"lamar",score:2}};
  const canonical={home_school_id:"lamar",away_school_id:"booneville"};
  assert.deepEqual(canonicalDesiredFinal(target,canonical),{
    status:"FINAL",home_school_id:"lamar",away_school_id:"booneville",home_score:2,away_score:3
  });
});
