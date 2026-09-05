import test from "node:test";
import assert from "node:assert/strict";
import { detectEventConflicts, resolveCanonicalEvent } from "../src/schedule-authority-core.js";

const common={
  sport:"football",gender:"boys",season:"2026",
  reporting_school_id:"conway",opponent_school_id:"bentonville",
  scheduled_at:"2026-09-05T00:00:00.000Z",scheduled_time_known:1,
  home_away:"home",venue:"John McConnell Stadium"
};

function scheduleObservation(overrides={}) {
  return {
    ...common,id:"schedule",source_id:"dragonfly-schedule",
    parser_type:"dragonfly-public",source_type:"official-conference",authority_rank:10,
    source_event_key:"native:game-1",status:"SCHEDULED",team_score:null,opponent_score:null,
    ...overrides
  };
}

function resultObservation(overrides={}) {
  return {
    ...common,id:"result",source_id:"official-school-result",
    parser_type:"mascot-media",source_type:"official-school",authority_rank:20,
    source_event_key:"bentonville|home|1",status:"FINAL",team_score:14,opponent_score:20,
    ...overrides
  };
}

test("scheduled schedule observation plus official final is normal lifecycle progression",()=>{
  const observations=[scheduleObservation(),resultObservation()];
  const conflicts=detectEventConflicts(observations);
  assert.equal(conflicts.some(conflict=>conflict.type==="STATUS"),false);

  const canonical=resolveCanonicalEvent(observations);
  assert.equal(canonical.status,"FINAL");
  assert.equal(canonical.homeScore,14);
  assert.equal(canonical.awayScore,20);
  assert.equal(canonical.trustState,"CORROBORATED");
  assert.equal(canonical.conflicts.length,0);
});

test("genuinely incompatible non-final statuses remain conflicts",()=>{
  const conflicts=detectEventConflicts([
    scheduleObservation(),
    resultObservation({status:"POSTPONED",team_score:null,opponent_score:null})
  ]);
  assert.equal(conflicts.some(conflict=>conflict.type==="STATUS"),true);
});
