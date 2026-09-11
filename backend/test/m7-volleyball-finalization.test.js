import test from "node:test";
import assert from "node:assert/strict";
import { planDuplicateCanonicalMerges, planOrphanAttachments, planCoordinateUpdates } from "../src/m7-volleyball-finalization.js";

function event(overrides={}){
  return {
    id:"ce-a",participant_a_school_id:"a",participant_b_school_id:"b",
    home_school_id:"a",away_school_id:"b",scheduled_at:"2026-09-01T23:00:00.000Z",
    scheduled_time_known:1,status:"FINAL",home_score:3,away_score:1,
    selected_source_id:"dragonfly-a",selected_authority_rank:10,selected_parser_type:"dragonfly-public",
    latitude:null,longitude:null,...overrides
  };
}

test("duplicate planner merges exact-score nearby duplicate while preserving authority keeper",()=>{
  const canonicals=[
    event(),
    event({id:"ce-b",scheduled_at:"2026-09-01T23:08:00.000Z",selected_source_id:"maxpreps-a",selected_authority_rank:80})
  ];
  const members=[
    {canonical_event_id:"ce-a",game_id:"g1",reporting_team_id:"ta"},
    {canonical_event_id:"ce-b",game_id:"g2",reporting_team_id:"tb"}
  ];
  const plan=planDuplicateCanonicalMerges(canonicals,members,[]);
  assert.equal(plan.merges.length,1);
  assert.equal(plan.merges[0].keeper_id,"ce-a");
  assert.deepEqual(plan.merges[0].loser_ids,["ce-b"]);
  assert.equal(plan.blocked.length,0);
});

test("duplicate planner refuses contradictory score evidence",()=>{
  const canonicals=[event(),event({id:"ce-b",away_score:2,scheduled_at:"2026-09-01T23:08:00.000Z"})];
  const plan=planDuplicateCanonicalMerges(canonicals,[],[]);
  assert.equal(plan.merges.length,0);
  assert.equal(plan.blocked[0].reason,"final_scores_disagree");
});

test("duplicate planner refuses schedule-only duplicates without final evidence",()=>{
  const canonicals=[
    event({status:"SCHEDULED",home_score:null,away_score:null}),
    event({id:"ce-b",status:"SCHEDULED",home_score:null,away_score:null,scheduled_at:"2026-09-01T23:08:00.000Z"})
  ];
  const plan=planDuplicateCanonicalMerges(canonicals,[],[]);
  assert.equal(plan.merges.length,0);
  assert.equal(plan.blocked[0].reason,"schedule_only_duplicate_not_proven");
});

test("orphan planner attaches only one exact participant/date/score canonical",()=>{
  const orphan={id:"g-orphan",team_id:"ta",source_id:"src",reporting_school_id:"a",opponent_school_id:"b",scheduled_at:"2026-09-01T23:03:00.000Z",scheduled_time_known:1,status:"FINAL",team_score:3,opponent_score:1};
  const plan=planOrphanAttachments([orphan],[event()],[]);
  assert.equal(plan.attachments.length,1);
  assert.equal(plan.attachments[0].canonical_event_id,"ce-a");
});

test("coordinate planner trusts selected-source member location",()=>{
  const canonicals=[event()];
  const members=[
    {canonical_event_id:"ce-a",source_id:"dragonfly-a",latitude:35.1,longitude:-92.4},
    {canonical_event_id:"ce-a",source_id:"other",latitude:35.2,longitude:-92.5}
  ];
  const plan=planCoordinateUpdates(canonicals,members);
  assert.deepEqual(plan.updates,[{canonical_event_id:"ce-a",latitude:35.1,longitude:-92.4,evidence:"selected_source_member"}]);
});

test("coordinate planner rejects zero-zero as missing location evidence",()=>{
  const canonicals=[event()];
  const members=[{canonical_event_id:"ce-a",source_id:"dragonfly-a",latitude:0,longitude:0}];
  const plan=planCoordinateUpdates(canonicals,members);
  assert.equal(plan.updates.length,0);
});
