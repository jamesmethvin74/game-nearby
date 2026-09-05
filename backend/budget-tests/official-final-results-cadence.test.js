import test from "node:test";
import assert from "node:assert/strict";
import { scopePolicy, OFFICIAL_FINAL_RESULTS_MAX_SOURCES_PER_RUN } from "../src/scoped-cadence-runner.js";
import { shouldRunOfficialFinalResults } from "../src/milestone2-scheduled-worker.js";

test("official final-result pass runs on Friday game-night plus evening and morning reconciliation windows",()=>{
  assert.equal(shouldRunOfficialFinalResults({kind:"friday-football-results"}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"evening-results"}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"morning-results"}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"afternoon-schedule-check"}),false);
  assert.equal(shouldRunOfficialFinalResults({kind:"weekly-catalog-maintenance"}),false);
});

test("official final-result selector is high-school, official-source, three-sport, and statewide-football sized",()=>{
  const policy=scopePolicy({scope:"high-school-final-results",activeResultMinutes:120});
  assert.equal(policy.maxSources,256);
  assert.equal(OFFICIAL_FINAL_RESULTS_MAX_SOURCES_PER_RUN,256);
  assert.equal(policy.dueMode,"active-result");
  assert.equal(policy.activeMinutes,120);
  assert.match(policy.where,/sch\.level='high-school'/);
  assert.match(policy.where,/src\.source_type='official-school'/);
  assert.match(policy.where,/mascot-media/);
  assert.match(policy.where,/rankone-public/);
  assert.match(policy.where,/football/);
  assert.match(policy.where,/volleyball/);
  assert.match(policy.where,/basketball/);
});

test("official final-result selector only considers scheduled games old enough to be finished",()=>{
  const policy=scopePolicy({scope:"high-school-final-results"});
  assert.match(policy.gameWindow,/gx\.status='SCHEDULED'/);
  assert.match(policy.gameWindow,/gx\.scheduled_time_known=1/);
  assert.match(policy.gameWindow,/football.*-150 minutes/s);
  assert.match(policy.gameWindow,/volleyball.*-90 minutes/s);
  assert.match(policy.gameWindow,/basketball.*-120 minutes/s);
  assert.match(policy.gameWindow,/-900 minutes/);
});
