import test from "node:test";
import assert from "node:assert/strict";
import { planM7VolleyballDateFinals } from "../src/m7-volleyball-date-final-plan.js";

test("M7 date-level final planner rejects dates outside the fixed 2026 season shape before touching D1",async()=>{
  await assert.rejects(()=>planM7VolleyballDateFinals({},"2025-08-18"),/must be YYYY-MM-DD in 2026/);
  await assert.rejects(()=>planM7VolleyballDateFinals({},"not-a-date"),/must be YYYY-MM-DD in 2026/);
});
