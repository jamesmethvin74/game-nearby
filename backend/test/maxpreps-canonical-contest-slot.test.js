import test from "node:test";
import assert from "node:assert/strict";
import { canonicalCandidateKey, observationsLikelySameEvent, resolveCanonicalEvent } from "../src/schedule-authority-core.js";

function observation({contest,source,team="a-team",school="a",opponent="b",side="home",teamScore=2,opponentScore=0}={}) {
  return {
    id:`${source}:native:${contest}`,
    source_id:source,
    source_event_key:`native:${contest}`,
    parser_type:"maxpreps-scores",
    authority_rank:80,
    source_priority:9,
    sport:"volleyball",gender:"girls",season:"2026",
    reporting_team_id:team,reporting_school_id:school,opponent_school_id:opponent,
    scheduled_at:"2026-08-29T17:00:00.000Z",scheduled_time_known:0,
    home_away:side,status:"FINAL",team_score:teamScore,opponent_score:opponentScore
  };
}

test("different MaxPreps contests on same pair/date do not reconcile together",()=>{
  const a=observation({contest:"contest-a",source:"mp:a"});
  const b=observation({contest:"contest-b",source:"mp:b",team:"b-team",school:"b",opponent:"a",side:"away",teamScore:0,opponentScore:2});
  assert.equal(observationsLikelySameEvent(a,b),false);
});

test("reciprocal observations for the same MaxPreps contest share a contest-specific canonical slot",()=>{
  const a=observation({contest:"contest-a",source:"mp:a"});
  const b=observation({contest:"contest-a",source:"mp:b",team:"b-team",school:"b",opponent:"a",side:"away",teamScore:0,opponentScore:2});
  assert.equal(observationsLikelySameEvent(a,b),true);
  assert.match(canonicalCandidateKey(a),/\|mp-contest-a$/);
  const resolved=resolveCanonicalEvent([a,b]);
  assert.match(resolved.id,/:mp-contest-a$/);
  assert.equal(resolved.homeScore,2);
  assert.equal(resolved.awayScore,0);
});
