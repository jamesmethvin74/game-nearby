import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSchoolAlias } from "../src/schedule-authority-core.js";
import { buildVolleyballCompletenessAudit } from "../src/volleyball-completeness-audit.js";
import {
  applyPublishedVolleyballIdentityOverrides,
  replaceLegacyConflictClassification,
  buildM7FinalGapPlan
} from "../src/m7-volleyball-completeness-audit.js";

function team(id,schoolId,conferenceId){
  return {
    team_id:id,school_id:schoolId,conference_id:conferenceId,conference_name:conferenceId,
    school_name:"Southside",raw_school_name:"Southside",location_matched_name:null,
    record_exists:1,wins:0,losses:0,ties:0,conference_wins:0,conference_losses:0,conference_ties:0,
    source_count:1,enabled_source_count:1
  };
}

test("M7 audit reuses Southside conference identity overrides instead of undoing M6",()=>{
  const teams=[
    team("df-s3xu7u-volleyball-2026","school-batesville","4a-4-volleyball"),
    team("df-jh2s9b-volleyball-2026","school-fort-smith","6a-west-volleyball")
  ];
  const published={
    conferences:[
      {id:"4a-4",name:"4A 4",standings:[{school_name:"Southside",overall_record:"0-0",conference_record:"0-0"}]},
      {id:"6a-west",name:"6A West",standings:[{school_name:"Southside",overall_record:"0-0",conference_record:"0-0"}]}
    ]
  };
  const corrected=applyPublishedVolleyballIdentityOverrides(published,teams);
  const batesvilleAlias=normalizeSchoolAlias(corrected.teams[0].location_matched_name);
  const fortSmithAlias=normalizeSchoolAlias(corrected.teams[1].location_matched_name);
  assert.notEqual(batesvilleAlias,fortSmithAlias);
  assert.equal(normalizeSchoolAlias(corrected.published.conferences[0].standings[0].school_name),batesvilleAlias);
  assert.equal(normalizeSchoolAlias(corrected.published.conferences[1].standings[0].school_name),fortSmithAlias);

  const audit=buildVolleyballCompletenessAudit({teams:corrected.teams,published:corrected.published});
  assert.equal(audit.exceptions_by_deficiency.wrong_conference_membership,undefined);
  assert.equal(audit.teams.filter(row=>row.published_standings_present).length,2);
});

test("M7 audit labels only SCORE conflicts as contradictory final scores",()=>{
  const audit={
    summary:{exception_count:263},
    exceptions_by_deficiency:{contradictory_final_score:{count:263,exceptions:[]}}
  };
  const teams=[
    {team_id:"team-a",school_id:"school-a",school_name:"A",conference_name:"C",conference_id:"c"},
    {team_id:"team-b",school_id:"school-b",school_name:"B",conference_name:"C",conference_id:"c"}
  ];
  const conflictRows=[
    {canonical_event_id:"event-score",participant_a_school_id:"school-a",participant_b_school_id:"school-b",status:"FINAL",home_score:3,away_score:1,conflict_type:"SCORE"},
    {canonical_event_id:"event-venue",participant_a_school_id:"school-a",participant_b_school_id:"external",status:"SCHEDULED",home_score:null,away_score:null,conflict_type:"VENUE"}
  ];
  const corrected=replaceLegacyConflictClassification(audit,conflictRows,teams);
  assert.equal(corrected.exceptions_by_deficiency.contradictory_final_score.count,2);
  assert.equal(corrected.exceptions_by_deficiency.canonical_reconciliation_conflict.count,1);
  assert.equal(corrected.summary.exception_count,3);
});

test("M7 final gap planner counts unique contests rather than affected-team exceptions",()=>{
  const teams=[
    {team_id:"team-a",school_id:"school-a",school_name:"Alpha",raw_school_name:"Alpha"},
    {team_id:"team-b",school_id:"school-b",school_name:"Beta",raw_school_name:"Beta"},
    {team_id:"team-c",school_id:"school-c",school_name:"Gamma",raw_school_name:"Gamma"}
  ];
  const canonicals=[
    {canonical_event_id:"event-ab",participant_a_school_id:"school-a",participant_b_school_id:"school-b",home_school_id:"school-a",away_school_id:"school-b",scheduled_at:"2026-08-25T23:00:00Z",status:"SCHEDULED",home_score:null,away_score:null}
  ];
  const maxPreps={
    matched:[
      {contestId:"contest-ab",localDate:"2026-08-25",sourceUrl:"https://example.test/ab",home:{name:"Alpha",score:3},away:{name:"Beta",score:1},homeTeam:{team_id:"team-a",school_id:"school-a"},awayTeam:{team_id:"team-b",school_id:"school-b"}},
      {contestId:"contest-ac",localDate:"2026-08-26",sourceUrl:"https://example.test/ac",home:{name:"Alpha",score:3},away:{name:"Gamma",score:0},homeTeam:{team_id:"team-a",school_id:"school-a"},awayTeam:{team_id:"team-c",school_id:"school-c"}}
    ],
    ambiguousFinals:[
      {contestId:"contest-ext",localDate:"2026-08-27",sourceUrl:"https://example.test/ext",home:{name:"Alpha",score:3},away:{name:"External Academy",score:2}}
    ]
  };
  const plan=buildM7FinalGapPlan({teams,canonicals,maxPreps});
  assert.equal(plan.unique_actionable_contests,3);
  assert.equal(plan.by_type.stale_scheduled_external_final,1);
  assert.equal(plan.by_type.missing_externally_published_final,1);
  assert.equal(plan.by_type.authority_final_unmatched_opponent,1);
  assert.deepEqual(plan.date_cohorts.map(row=>row.total),[1,1,1]);
});
