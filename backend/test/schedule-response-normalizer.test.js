import test from "node:test";
import assert from "node:assert/strict";
import { applySchoolDisplayNames, dedupeScheduleRows, footballRowsConflictSameDay, humanizeScheduleText, opponentNamesLikelySame, recordFromScheduleRows, scheduleRowsLikelyDuplicate, scheduleRowsLikelySameLogicalGame, staleSameDayOpponentTwin } from "../src/schedule-response-normalizer.js";

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

test("Bryant known-time observations with distinct canonical ids collapse and the verified final wins", () => {
  const stale = {
    id:"benton-stale",
    canonical_event_id:"ce-benton-schedule",
    school_id:"bryant",
    sport:"football",
    gender:"boys",
    scheduled_at:"2026-08-29T00:00:00.000Z",
    scheduled_time_known:1,
    opponent:"Benton High School",
    status:"SCHEDULED",
    team_score:null,
    opponent_score:null,
    result:null,
    parser_type:"dragonfly-public",
    source_type:"official-conference",
    data_trust:"AUTHORITATIVE_LIVE"
  };
  const final = {
    id:"benton-final",
    canonical_event_id:"ce-benton-final",
    school_id:"bryant",
    sport:"football",
    gender:"boys",
    scheduled_at:"2026-08-29T00:00:00.000Z",
    scheduled_time_known:1,
    opponent:"Benton",
    status:"FINAL",
    team_score:42,
    opponent_score:43,
    result:"L",
    counts_for_record:1,
    parser_type:"mascot-media",
    source_type:"official-school",
    data_trust:"SINGLE_SOURCE_LIVE"
  };

  assert.equal(scheduleRowsLikelyDuplicate(stale, final, {reportingSchoolId:"bryant"}), true);
  const rows = dedupeScheduleRows([stale, final], {reportingSchoolId:"bryant"});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "FINAL");
  assert.equal(rows[0].team_score, 42);
  assert.equal(rows[0].opponent_score, 43);
  assert.equal(rows[0].result, "L");
  assert.equal(rows[0].schedule_observation_count, 2);
});

test("Bryant Alexandria source aliases normalize without confusing the Louisiana qualifier", () => {
  assert.equal(opponentNamesLikelySame("Alexandria Senior High School", "Alexandria (LA)"), true);

  const rows = dedupeScheduleRows([
    {
      canonical_event_id:"ce-alexandria-schedule",
      school_id:"bryant",
      sport:"football",
      gender:"boys",
      scheduled_at:"2026-09-05T00:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Alexandria Senior High School",
      status:"SCHEDULED"
    },
    {
      canonical_event_id:"ce-alexandria-final",
      school_id:"bryant",
      sport:"football",
      gender:"boys",
      scheduled_at:"2026-09-05T00:00:00.000Z",
      scheduled_time_known:1,
      opponent:"Alexandria (LA)",
      status:"FINAL",
      team_score:20,
      opponent_score:44,
      result:"L",
      counts_for_record:1,
      source_type:"official-school",
      parser_type:"mascot-media"
    }
  ], {reportingSchoolId:"bryant"});

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "FINAL");
  assert.equal(rows[0].team_score, 20);
  assert.equal(rows[0].opponent_score, 44);
});

test("distinct date-only canonical rows remain separate to protect real rematches", () => {
  const base = {
    school_id:"conway",
    sport:"volleyball",
    gender:"girls",
    scheduled_at:"2026-09-19T05:00:00.000Z",
    scheduled_time_known:0,
    opponent:"Nixa High School",
    status:"SCHEDULED"
  };
  const a = {...base, canonical_event_id:"ce-rematch-a"};
  const b = {...base, canonical_event_id:"ce-rematch-b"};
  assert.equal(scheduleRowsLikelyDuplicate(a,b,{reportingSchoolId:"conway"}), false);
  assert.equal(dedupeScheduleRows([a,b],{reportingSchoolId:"conway"}).length, 2);
});


test("record calculation counts one real result when providers duplicate the same final", () => {
  const rows = [
    {school_id:"greenwood",sport:"volleyball",gender:"girls",scheduled_at:"2026-08-27T23:00:00.000Z",opponent:"Conway High School",status:"FINAL",team_score:3,opponent_score:1,conference_game:0,counts_for_record:1,canonical_event_id:"ce-greenwood-conway",parser_type:"dragonfly-public",source_type:"official-conference",data_trust:"AUTHORITATIVE_LIVE"},
    {school_id:"greenwood",sport:"volleyball",gender:"girls",scheduled_at:"2026-08-27T23:00:00.000Z",opponent:"Conway",status:"FINAL",team_score:3,opponent_score:1,conference_game:0,counts_for_record:1,canonical_event_id:"ce-greenwood-conway",parser_type:"dragonfly-public",source_type:"official-conference",data_trust:"CORROBORATED"},
    {school_id:"greenwood",sport:"volleyball",gender:"girls",scheduled_at:"2026-08-28T23:00:00.000Z",opponent:"Benton High School",status:"FINAL",team_score:1,opponent_score:3,conference_game:1,counts_for_record:1,canonical_event_id:"ce-c",parser_type:"dragonfly-public",source_type:"official-conference",data_trust:"CORROBORATED"}
  ];
  const record=recordFromScheduleRows(rows,{reportingSchoolId:"greenwood"});
  assert.deepEqual(record,{wins:1,losses:1,ties:0,conference_wins:0,conference_losses:1,conference_ties:0,scored_finals:2});
});


test("football same-day invariant collapses different source opponents without canonical merging",()=>{
  const full={
    id:"nlr-robinson-full",
    canonical_event_id:"ce-robinson-full",
    school_id:"north-little-rock",
    sport:"football",
    gender:"boys",
    scheduled_at:"2026-08-22T00:00:00.000Z",
    scheduled_time_known:1,
    opponent:"Joe T. Robinson High School",
    opponent_school_id:"joe-t-robinson",
    status:"SCHEDULED",
    venue:"North Little Rock High School Stadium",
    source_type:"official-school"
  };
  const short={
    id:"nlr-robinson-short",
    canonical_event_id:"ce-robinson-short",
    school_id:"north-little-rock",
    sport:"football",
    gender:"boys",
    scheduled_at:"2026-08-22T00:00:00.000Z",
    scheduled_time_known:1,
    opponent:"Robinson",
    opponent_school_id:"robinson-legacy",
    status:"SCHEDULED",
    venue:"TBD NLRHS Stadium",
    source_type:"secondary"
  };
  assert.equal(footballRowsConflictSameDay(full,short,{reportingSchoolId:"north-little-rock"}),true);
  assert.equal(scheduleRowsLikelySameLogicalGame(full,short,{reportingSchoolId:"north-little-rock"}),false);
  assert.equal(scheduleRowsLikelyDuplicate(full,short,{reportingSchoolId:"north-little-rock"}),true);
  const rows=dedupeScheduleRows([full,short],{reportingSchoolId:"north-little-rock"});
  assert.equal(rows.length,1);
  assert.equal(rows[0].opponent,"Joe T. Robinson High School");
});

test("canceled football entry can coexist with a replacement on the same date",()=>{
  const canceled={
    school_id:"north-little-rock",sport:"football",gender:"boys",
    scheduled_at:"2026-08-22T00:00:00.000Z",opponent:"Original Opponent",status:"CANCELED"
  };
  const replacement={
    school_id:"north-little-rock",sport:"football",gender:"boys",
    scheduled_at:"2026-08-22T01:00:00.000Z",opponent:"Replacement Opponent",status:"SCHEDULED"
  };
  assert.equal(footballRowsConflictSameDay(canceled,replacement,{reportingSchoolId:"north-little-rock"}),false);
  assert.equal(dedupeScheduleRows([canceled,replacement],{reportingSchoolId:"north-little-rock"}).length,2);
});

test("same-day volleyball contests remain allowed for tournament play",()=>{
  const a={school_id:"conway",sport:"volleyball",gender:"girls",scheduled_at:"2026-09-19T15:00:00.000Z",opponent:"Nixa",status:"SCHEDULED"};
  const b={school_id:"conway",sport:"volleyball",gender:"girls",scheduled_at:"2026-09-19T19:00:00.000Z",opponent:"Ozark",status:"SCHEDULED"};
  assert.equal(footballRowsConflictSameDay(a,b,{reportingSchoolId:"conway"}),false);
  assert.equal(dedupeScheduleRows([a,b],{reportingSchoolId:"conway"}).length,2);
});


test("same-day scored final suppresses stale Pulaski Academy benefit twin despite one-hour time drift",()=>{
  const finalRow={
    id:"nlr-pa-final",school_id:"north-little-rock",sport:"volleyball",gender:"girls",
    scheduled_at:"2026-08-18T22:30:00.000Z",scheduled_time_known:1,
    opponent:"Pulaski Academy High School",opponent_school_id:"pulaski-academy",
    status:"FINAL",team_score:0,opponent_score:1,
    canonical_event_id:"ce-pa-final",source_type:"official-conference",parser_type:"dragonfly-public"
  };
  const staleRow={
    id:"nlr-pa-benefit",school_id:"north-little-rock",sport:"volleyball",gender:"girls",
    scheduled_at:"2026-08-18T23:30:00.000Z",scheduled_time_known:1,
    opponent:"Pulaski Academy (Benefit)",opponent_school_id:"pulaski-academy-legacy",
    status:"SCHEDULED",team_score:null,opponent_score:null,
    canonical_event_id:"ce-pa-benefit",source_type:"official-school",parser_type:"mascot-media"
  };
  assert.equal(staleSameDayOpponentTwin(finalRow,staleRow,{reportingSchoolId:"north-little-rock"}),true);
  const rows=dedupeScheduleRows([staleRow,finalRow],{reportingSchoolId:"north-little-rock"});
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,"FINAL");
  assert.equal(rows[0].team_score,0);
  assert.equal(rows[0].opponent_score,1);
});

test("same-day scored final suppresses stale Beebe twin despite multi-hour source time drift",()=>{
  const finalRow={
    id:"nlr-beebe-final",school_id:"north-little-rock",sport:"volleyball",gender:"girls",
    scheduled_at:"2026-08-24T21:30:00.000Z",scheduled_time_known:1,
    opponent:"Beebe High School",opponent_school_id:"beebe",
    status:"FINAL",team_score:0,opponent_score:3,
    canonical_event_id:"ce-beebe-final",source_type:"official-school",parser_type:"mascot-media"
  };
  const staleRow={
    id:"nlr-beebe-stale",school_id:"north-little-rock",sport:"volleyball",gender:"girls",
    scheduled_at:"2026-08-25T00:00:00.000Z",scheduled_time_known:1,
    opponent:"BEEBE HIGH SCHOOL",opponent_school_id:"beebe-alt",
    status:"SCHEDULED",team_score:null,opponent_score:null,
    canonical_event_id:"ce-beebe-stale",source_type:"secondary",parser_type:"legacy"
  };
  assert.equal(staleSameDayOpponentTwin(finalRow,staleRow,{reportingSchoolId:"north-little-rock"}),true);
  const rows=dedupeScheduleRows([finalRow,staleRow],{reportingSchoolId:"north-little-rock"});
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,"FINAL");
});

test("two completed same-day volleyball matches against one opponent are not auto-collapsed",()=>{
  const first={
    id:"doubleheader-1",school_id:"sample",sport:"volleyball",gender:"girls",
    scheduled_at:"2026-09-19T15:00:00.000Z",opponent:"Opponent High School",opponent_school_id:"opp",
    status:"FINAL",team_score:2,opponent_score:0,canonical_event_id:"ce-1"
  };
  const second={
    id:"doubleheader-2",school_id:"sample",sport:"volleyball",gender:"girls",
    scheduled_at:"2026-09-19T19:00:00.000Z",opponent:"Opponent High School",opponent_school_id:"opp",
    status:"FINAL",team_score:2,opponent_score:1,canonical_event_id:"ce-2"
  };
  assert.equal(staleSameDayOpponentTwin(first,second,{reportingSchoolId:"sample"}),false);
  assert.equal(dedupeScheduleRows([first,second],{reportingSchoolId:"sample"}).length,2);
});
