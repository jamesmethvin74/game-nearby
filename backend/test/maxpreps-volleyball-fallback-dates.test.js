import test from "node:test";
import assert from "node:assert/strict";
import { collectionPlanAt } from "../src/collection-cadence.js";
import { datesForMaxPrepsVolleyballFallback } from "../src/maxpreps-volleyball-result-collector.js";

test("live volleyball cadence checks only the current Central date",()=>{
  const when=new Date("2026-09-03T23:00:00.000Z");
  const plan=collectionPlanAt(when);
  assert.equal(plan.kind,"volleyball-live-results");
  assert.deepEqual(datesForMaxPrepsVolleyballFallback(plan,when),["2026-09-03"]);
});

test("morning result cadence checks only yesterday's Central date",()=>{
  const when=new Date("2026-09-04T11:00:00.000Z");
  const plan=collectionPlanAt(when);
  assert.equal(plan.kind,"morning-results");
  assert.deepEqual(datesForMaxPrepsVolleyballFallback(plan,when),["2026-09-03"]);
});

test("non-result schedule maintenance does not call MaxPreps score fallback",()=>{
  const when=new Date("2026-09-03T20:00:00.000Z");
  const plan=collectionPlanAt(when);
  assert.equal(plan.kind,"afternoon-schedule-check");
  assert.deepEqual(datesForMaxPrepsVolleyballFallback(plan,when),[]);
});
