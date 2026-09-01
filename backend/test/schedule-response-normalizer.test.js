import test from "node:test";
import assert from "node:assert/strict";
import { applySchoolDisplayNames, dedupeScheduleRows, humanizeScheduleText, recordFromScheduleRows, scheduleRowsLikelyDuplicate } from "../src/schedule-response-normalizer.js";

const displayNames = new Map([
  ["conway", "Conway High School"],
  ["lakeside", "Lakeside High School (Hot Springs)"],
  ["valley", "Valley Springs High School"],
  ["melbourne", "Melbourne High School"]
]);

test("Conway/Lakeside DragonFly and school-feed observations collapse into one game", () => {
  const dragonfly = applySchoolDisplayNames({
    id: "ce-live",
    canonical_event_id: "ce-live",
    school_id: "conway",
    sport: "volleyball",
    gender: "girls",
    scheduled_at: "2026-08-31T23:00:00.000Z",
    scheduled_time_known: 1,
    opponent: "Lakeside High School (Hot Springs)",
    home_away: "home",
    venue: "CONWAY HIGH SCHOOL",
    canonical_venue: "CONWAY HIGH SCHOOL",
    canonical_home_school_id: "conway",
    canonical_away_school_id: "lakeside",
    canonical_home_name: "Conway High School",
    canonical_away_name: "Lakeside High School (Hot Springs)",
    source_type: "official-conference",
    parser_type: "dragonfly-public",
    data_trust: "AUTHORITATIVE_LIVE"
  }, displayNames);

  const schoolFeed = applySchoolDisplayNames({
    id: "school-live",
    school_id: "conway",
    sport: "volleyball",
    gender: "girls",
    scheduled_at: "2026-08-31T23:00:00.000Z",
    scheduled_time_known: 1,
    opponent: "Lakeside",
    home_away: "home",
    venue: "Buzz Bolding Arena",
    source_type: "official-school",
    parser_type: "mascot-media",
    data_trust: "SINGLE_SOURCE_LIVE"
  }, displayNames);

  assert.equal(scheduleRowsLikelyDuplicate(dragonfly, schoolFeed), true);
  const result = dedupeScheduleRows([dragonfly, schoolFeed]);
  assert.equal(result.length, 1);
  assert.equal(result[0].canonical_event_id, "ce-live");
  assert.equal(result[0].opponent, "Lakeside High School (Hot Springs)");
  assert.equal(result[0].venue, "Buzz Bolding Arena", "specific school venue should beat a generic school-name venue");
  assert.equal(result[0].schedule_observation_count, 2);
  assert.equal(result[0].schedule_confirmed_by_school, true);
});

test("authoritative school names clean up raw all-caps DragonFly schedule text", () => {
  const row = applySchoolDisplayNames({
    school_id: "valley",
    sport: "volleyball",
    gender: "girls",
    opponent: "MELBOURNE HIGH SCHOOL",
    venue: "MELBOURNE HIGH SCHOOL",
    canonical_home_school_id: "melbourne",
    canonical_away_school_id: "valley",
    canonical_home_name: "MELBOURNE HIGH SCHOOL",
    canonical_away_name: "VALLEY SPRINGS HIGH SCHOOL"
  }, displayNames);

  assert.equal(row.school_name, "Valley Springs High School");
  assert.equal(row.opponent, "Melbourne High School");
  assert.equal(row.canonical_home_name, "Melbourne High School");
  assert.equal(row.canonical_away_name, "Valley Springs High School");
  assert.equal(row.venue, "Melbourne High School");
  assert.equal(humanizeScheduleText("CABOT HIGH SCHOOL"), "Cabot High School");
});

test("same opponent at materially different times remains separate", () => {
  const a = { school_id:"conway", sport:"volleyball", gender:"girls", scheduled_at:"2026-09-19T15:00:00.000Z", opponent:"NIXA HIGH" };
  const b = { school_id:"conway", sport:"volleyball", gender:"girls", scheduled_at:"2026-09-19T17:00:00.000Z", opponent:"Nixa Springfield Classic" };
  assert.equal(scheduleRowsLikelyDuplicate(a,b), false);
  assert.equal(dedupeScheduleRows([a,b]).length, 2);
});


test("record calculation counts one real result when providers duplicate the same final", () => {
  const rows = [
    {school_id:"greenwood",sport:"volleyball",gender:"girls",scheduled_at:"2026-08-27T23:00:00.000Z",opponent:"Conway High School",status:"FINAL",team_score:3,opponent_score:1,conference_game:0,counts_for_record:1,canonical_event_id:"ce-a",parser_type:"dragonfly-public",source_type:"official-conference",data_trust:"AUTHORITATIVE_LIVE"},
    {school_id:"greenwood",sport:"volleyball",gender:"girls",scheduled_at:"2026-08-27T23:00:00.000Z",opponent:"Conway",status:"FINAL",team_score:3,opponent_score:1,conference_game:0,counts_for_record:1,canonical_event_id:"ce-b",parser_type:"dragonfly-public",source_type:"official-conference",data_trust:"CORROBORATED"},
    {school_id:"greenwood",sport:"volleyball",gender:"girls",scheduled_at:"2026-08-28T23:00:00.000Z",opponent:"Benton High School",status:"FINAL",team_score:1,opponent_score:3,conference_game:1,counts_for_record:1,canonical_event_id:"ce-c",parser_type:"dragonfly-public",source_type:"official-conference",data_trust:"CORROBORATED"}
  ];
  const record=recordFromScheduleRows(rows,{reportingSchoolId:"greenwood"});
  assert.deepEqual(record,{wins:1,losses:1,ties:0,conference_wins:0,conference_losses:1,conference_ties:0,scored_finals:2});
});
