import test from "node:test";
import assert from "node:assert/strict";
import { collegeRecordSource, parseResultOutcome, summarizeCollegeScheduleRows } from "../src/college-records.js";

test("college record sources cover the college teams shown on Home", () => {
  assert.equal(collegeRecordSource({schoolId:"uca",sport:"soccer",gender:"women"})?.conferenceName, "UAC");
  assert.equal(collegeRecordSource({schoolId:"uca",sport:"football",gender:"men"})?.conferenceName, "UAC");
  assert.equal(collegeRecordSource({schoolId:"hendrix",sport:"soccer",gender:"women"})?.conferenceName, "SCAC");
  assert.equal(collegeRecordSource({schoolId:"hendrix",sport:"volleyball",gender:"women"})?.conferenceName, "SCAC");
});

test("official Sidearm outcomes build a real overall and conference record", () => {
  const source = collegeRecordSource({schoolId:"uca",sport:"soccer",gender:"women"});
  const record = summarizeCollegeScheduleRows([
    {result:"L, 1-4",conference:"",full:"Oral Roberts"},
    {result:"L, 1-2",conference:"",full:"Tulsa"},
    {result:"T, 2-2",conference:"",full:"Arkansas State"},
    {result:"W, 7-0",conference:"",full:"Alabama State"},
    {result:"L, 0-3",conference:"",full:"Missouri State"},
    {result:"W, 2-0",conference:"UAC",full:"Tarleton State"},
    {result:"W, 4-0",conference:"",full:"Louisiana Tech Exhibition"}
  ], source);

  assert.equal(record.wins, 2);
  assert.equal(record.losses, 3);
  assert.equal(record.ties, 1);
  assert.equal(record.conference_wins, 1);
  assert.equal(record.conference_losses, 0);
  assert.equal(record.conference_ties, 0);
  assert.equal(record.conference_name, "UAC");
  assert.equal(record.finals, 6);
});

test("record parser does not invent outcomes for games without a final", () => {
  assert.equal(parseResultOutcome(""), null);
  assert.equal(parseResultOutcome("7:00 PM"), null);
  assert.equal(parseResultOutcome("W, 36-24"), "W");
  assert.equal(parseResultOutcome("T, 2-2"), "T");
});
