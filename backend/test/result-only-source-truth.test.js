import test from "node:test";
import assert from "node:assert/strict";
import {
  currentObservationEvidenceSql,
  currentScheduleTruthSql,
  isResultOnlyObservationSource,
  resultOnlyObservationSql,
  resultOnlySourceSql,
  RESULT_ONLY_SOURCE_SUFFIX
} from "../src/current-schedule-truth.js";
import { enrichScheduleRowsWithResultEvidence } from "../src/schedule-response-normalizer.js";

test("result-only status is an explicit source role, never inferred from parser family",()=>{
  assert.equal(RESULT_ONLY_SOURCE_SUFFIX,"-official-school-results");

  // Full official school schedule sources are schedule authority even when they
  // use the same parser as supplemental result collectors.
  assert.equal(isResultOnlyObservationSource({
    source_id:"conway-football-official",
    source_type:"official-school",
    parser_type:"mascot-media"
  }),false);
  assert.equal(isResultOnlyObservationSource({
    source_id:"college-rankone-schedule",
    source_type:"official-school",
    parser_type:"rankone-public"
  }),false);

  // The bootstrapped supplemental result sources carry an explicit role in id.
  assert.equal(isResultOnlyObservationSource({
    source_id:"df-7x4sxh-football-2026-official-school-results",
    source_type:"official-school",
    parser_type:"mascot-media"
  }),true);
  assert.equal(isResultOnlyObservationSource({
    id:"some-team-official-school-results",
    parser_type:"rankone-public"
  }),true);

  assert.match(resultOnlyObservationSql("src"),/official-school-results/);
  assert.match(resultOnlySourceSql("src"),/official-school-results/);
  assert.doesNotMatch(resultOnlySourceSql("src"),/mascot-media/);
  assert.doesNotMatch(resultOnlySourceSql("src"),/rankone-public/);
  assert.doesNotMatch(currentObservationEvidenceSql("g","src"),/official-school-results/);
  assert.match(currentScheduleTruthSql("g","src"),/official-school-results/);
});

test("result-only final enriches an independently established canonical schedule game",()=>{
  const schedule=[{
    id:"sched-capital",team_id:"conway-football-2026",school_id:"conway",
    sport:"football",gender:"boys",season:"2026",canonical_event_id:"ce-capital",
    opponent:"Capital High School",opponent_school_id:"capital",
    scheduled_at:"2026-09-19T00:00:00.000Z",status:"SCHEDULED",
    team_score:null,opponent_score:null,result:null,
    source_id:"conway-football-official",source_type:"official-school",parser_type:"mascot-media"
  }];
  const resultOnly=[{
    id:"result-capital",team_id:"conway-football-2026",school_id:"conway",
    sport:"football",gender:"boys",season:"2026",canonical_event_id:"ce-capital",
    opponent:"Capital High School",opponent_school_id:"capital",
    scheduled_at:"2026-09-19T00:00:00.000Z",status:"FINAL",
    team_score:45,opponent_score:7,result:"W",
    source_id:"conway-football-2026-official-school-results",source_type:"official-school",parser_type:"mascot-media"
  }];
  const rows=enrichScheduleRowsWithResultEvidence(schedule,resultOnly,{reportingSchoolId:"conway"});
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,"FINAL");
  assert.equal(rows[0].team_score,45);
  assert.equal(rows[0].opponent_score,7);
  assert.equal(rows[0].source_id,"conway-football-official","schedule provenance remains the schedule authority");
});

test("unmatched result-only observation cannot manufacture a schedule row",()=>{
  const schedule=[{
    id:"sched-benton",team_id:"pea-ridge-football-2026",school_id:"pea-ridge",
    sport:"football",gender:"boys",season:"2026",canonical_event_id:"ce-benton",
    opponent:"Benton High School",opponent_school_id:"benton",
    scheduled_at:"2026-09-19T00:00:00.000Z",status:"SCHEDULED",
    source_id:"pea-ridge-football-official"
  }];
  const resultOnly=[{
    id:"fake",team_id:"pea-ridge-football-2026",school_id:"pea-ridge",
    sport:"football",gender:"boys",season:"2026",canonical_event_id:null,
    opponent:"Fake Opponent",opponent_school_id:"fake-opponent",
    scheduled_at:"2026-09-19T00:00:00.000Z",status:"FINAL",
    team_score:99,opponent_score:0,result:"W",
    source_id:"pea-ridge-football-2026-official-school-results",parser_type:"mascot-media"
  }];
  const rows=enrichScheduleRowsWithResultEvidence(schedule,resultOnly,{reportingSchoolId:"pea-ridge"});
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,"sched-benton");
  assert.equal(rows[0].status,"SCHEDULED");
  assert.equal(rows.some(row=>row.opponent==="Fake Opponent"),false);
});


test("split canonical IDs can still enrich one established logical game",()=>{
  const schedule=[{
    id:"schedule",team_id:"team-1",school_id:"school-1",sport:"football",gender:"boys",
    canonical_event_id:"ce-schedule",opponent:"Opponent High School",opponent_school_id:"opp-1",
    scheduled_at:"2026-09-18T23:00:00.000Z",status:"SCHEDULED",source_id:"schedule-source",
    source_type:"official-conference",parser_type:"dragonfly-public",scheduled_time_known:true
  }];
  const resultOnly=[{
    id:"result",team_id:"team-1",school_id:"school-1",sport:"football",gender:"boys",
    canonical_event_id:"ce-result",opponent:"Opponent High School",opponent_school_id:"opp-1",
    scheduled_at:"2026-09-18T23:02:00.000Z",status:"FINAL",team_score:21,opponent_score:7,result:"W",
    source_id:"team-1-official-school-results",source_type:"official-school",parser_type:"mascot-media",
    scheduled_time_known:true
  }];
  const rows=enrichScheduleRowsWithResultEvidence(schedule,resultOnly,{reportingSchoolId:"school-1",maxMinutes:5});
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,"FINAL");
  assert.equal(rows[0].team_score,21);
  assert.equal(rows[0].opponent_score,7);
  assert.equal(rows[0].source_id,"schedule-source");
});
