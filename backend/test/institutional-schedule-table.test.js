import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInstitutionalScheduleRows } from "../src/institutional-schedule-table.js";

const source = {
  season: "2026",
  timezone: "America/Chicago",
  school_city: "Harrison",
  school_state: "AR"
};

test("institutional schedule rows handle academic-year rollover and home/away", () => {
  const events = normalizeInstitutionalScheduleRows([
    { cells:["Oct. 30","Mission University JV","Harrison, AR","6:30 p.m.","",""] },
    { cells:["Jan. 6","SAU Tech","East Camden, AR","7:30 p.m.","W, 81-70",""] },
    { cells:["Feb. 24-27","NJCAA DII Region 2 Tournament","Harrison, AR","TBA","",""] }
  ], source);

  assert.equal(events.length, 2);
  assert.equal(events[0].opponent, "Mission University JV");
  assert.equal(events[0].homeAway, "home");
  assert.match(events[0].scheduledAt, /^2026-10-30T/);
  assert.equal(events[1].opponent, "SAU Tech");
  assert.equal(events[1].homeAway, "away");
  assert.match(events[1].scheduledAt, /^2027-01-07T01:30:00\.000Z$/);
  assert.equal(events[1].status, "FINAL");
  assert.equal(events[1].teamScore, 81);
  assert.equal(events[1].opponentScore, 70);
  assert.equal(events[1].result, "W");
});

test("institutional schedule rows keep scrimmages but exclude them from records", () => {
  const [event] = normalizeInstitutionalScheduleRows([
    { cells:["Oct. 20","Seminole State Scrimmage","Van Buren, AR","4:30 p.m.","",""] }
  ], source);
  assert.equal(event.countsForRecord, 0);
  assert.equal(event.notes, "Scrimmage");
});
