import test from "node:test";
import assert from "node:assert/strict";
import {
  scopePolicy,
  OFFICIAL_FINAL_RESULTS_MAX_SOURCES_PER_RUN,
  OFFICIAL_VOLLEYBALL_FINAL_RESULTS_MAX_SOURCES_PER_RUN
} from "../src/scoped-cadence-runner.js";
import {
  officialFinalResultsScope,
  shouldRunOfficialFinalResults
} from "../src/milestone2-scheduled-worker.js";

test("official final-result pass runs on live volleyball, Friday game-night, evening and morning windows",()=>{
  assert.equal(shouldRunOfficialFinalResults({kind:"volleyball-live-results",runVolleyballLive:true}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"saturday-college-results",runVolleyballLive:true}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"saturday-college-results",runVolleyballLive:false}),false);
  assert.equal(shouldRunOfficialFinalResults({kind:"friday-football-results",runVolleyballLive:true}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"evening-results"}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"morning-results"}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"afternoon-schedule-check"}),false);
  assert.equal(shouldRunOfficialFinalResults({kind:"weekly-catalog-maintenance"}),false);
});

test("live volleyball uses a narrow official-school fallback instead of the football-sized sweep",()=>{
  assert.equal(officialFinalResultsScope({kind:"volleyball-live-results",runVolleyballLive:true}),"high-school-volleyball-final-results");
  assert.equal(officialFinalResultsScope({kind:"saturday-college-results",runVolleyballLive:true}),"high-school-volleyball-final-results");
  assert.equal(officialFinalResultsScope({kind:"friday-football-results",runVolleyballLive:true}),"high-school-final-results");
  assert.equal(officialFinalResultsScope({kind:"morning-results"}),"high-school-final-results");

  const policy=scopePolicy({scope:"high-school-volleyball-final-results",activeResultMinutes:30});
  assert.equal(policy.maxSources,64);
  assert.equal(OFFICIAL_VOLLEYBALL_FINAL_RESULTS_MAX_SOURCES_PER_RUN,64);
  assert.equal(policy.dueMode,"active-result");
  assert.equal(policy.activeMinutes,30);
  assert.match(policy.where,/sch\.level='high-school'/);
  assert.match(policy.where,/src\.source_type='official-school'/);
  assert.match(policy.where,/mascot-media/);
  assert.match(policy.where,/rankone-public/);
  assert.match(policy.where,/t\.sport='volleyball'/);
  assert.match(policy.where,/t\.gender='girls'/);
  assert.doesNotMatch(policy.where,/football/);
  assert.doesNotMatch(policy.where,/basketball/);
  assert.match(policy.gameWindow,/gx\.status='SCHEDULED'/);
  assert.match(policy.gameWindow,/gx\.scheduled_time_known=1/);
  assert.match(policy.gameWindow,/-90 minutes/);
  assert.match(policy.gameWindow,/-900 minutes/);
});

test("broad official final-result selector remains high-school, official-source, three-sport, and statewide-football sized",()=>{
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

test("broad official final-result selector only considers scheduled games old enough to be finished",()=>{
  const policy=scopePolicy({scope:"high-school-final-results"});
  assert.match(policy.gameWindow,/gx\.status='SCHEDULED'/);
  assert.match(policy.gameWindow,/gx\.scheduled_time_known=1/);
  assert.match(policy.gameWindow,/football.*-150 minutes/s);
  assert.match(policy.gameWindow,/volleyball.*-90 minutes/s);
  assert.match(policy.gameWindow,/basketball.*-120 minutes/s);
  assert.match(policy.gameWindow,/-900 minutes/);
});
