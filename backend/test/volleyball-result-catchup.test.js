import test from "node:test";
import assert from "node:assert/strict";
import { datesForVolleyballHistoricalCatchup } from "../src/volleyball-result-catchup.js";

test("M7 morning historical catch-up fills only the two older days in a three-day completed window",()=>{
  const plan={kind:"morning-results"};
  const when=new Date("2026-09-10T11:00:00.000Z");
  assert.deepEqual(datesForVolleyballHistoricalCatchup(plan,when),["2026-09-08","2026-09-07"]);
});

test("M7 historical catch-up is inert outside morning results cadence",()=>{
  const when=new Date("2026-09-10T23:00:00.000Z");
  assert.deepEqual(datesForVolleyballHistoricalCatchup({kind:"volleyball-live-results"},when),[]);
  assert.deepEqual(datesForVolleyballHistoricalCatchup({kind:"evening-results"},when),[]);
});

test("M7 catch-up lookback is hard capped to seven completed days",()=>{
  const dates=datesForVolleyballHistoricalCatchup({kind:"morning-results"},new Date("2026-09-10T11:00:00.000Z"),99);
  assert.equal(dates.length,6);
  assert.equal(dates[0],"2026-09-08");
  assert.equal(dates.at(-1),"2026-09-03");
});
