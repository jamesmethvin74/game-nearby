import test from "node:test";
import assert from "node:assert/strict";
import {
  scopePolicy,
  OFFICIAL_FINAL_RESULTS_MAX_SOURCES_PER_RUN,
  OFFICIAL_VOLLEYBALL_FINAL_RESULTS_MAX_SOURCES_PER_RUN,
  OFFICIAL_LIVE_FINAL_RESULTS_MAX_SOURCES_PER_RUN
} from "../src/scoped-cadence-runner.js";
import {
  officialFinalResultsScope,
  shouldRunOfficialFinalResults
} from "../src/milestone2-scheduled-worker.js";

test("official final-result pass runs on live volleyball/basketball, Friday game-night, evening and morning windows",()=>{
  assert.equal(shouldRunOfficialFinalResults({kind:"volleyball-live-results",liveStatewideSports:["volleyball-girls"]}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"statewide-live-results",liveStatewideSports:["basketball-boys","basketball-girls"]}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"saturday-college-results",liveStatewideSports:["basketball-boys","basketball-girls"]}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"saturday-college-results",liveStatewideSports:[]}),false);
  assert.equal(shouldRunOfficialFinalResults({kind:"friday-football-results",liveStatewideSports:["volleyball-girls"]}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"evening-results"}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"morning-results"}),true);
  assert.equal(shouldRunOfficialFinalResults({kind:"afternoon-schedule-check"}),false);
  assert.equal(shouldRunOfficialFinalResults({kind:"weekly-catalog-maintenance"}),false);
});

test("live volleyball preserves its narrow official-school fallback",()=>{
  const plan={kind:"volleyball-live-results",liveStatewideSports:["volleyball-girls"]};
  assert.equal(officialFinalResultsScope(plan),"high-school-volleyball-final-results");

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

test("live basketball uses a bounded explicit sport/gender official fallback",()=>{
  const plan={kind:"statewide-live-results",liveStatewideSports:["basketball-boys","basketball-girls"]};
  assert.equal(officialFinalResultsScope(plan),"high-school-live-final-results");
  const policy=scopePolicy({
    scope:"high-school-live-final-results",
    activeResultMinutes:30,
    liveStatewideSports:plan.liveStatewideSports
  });
  assert.equal(policy.maxSources,64);
  assert.equal(OFFICIAL_LIVE_FINAL_RESULTS_MAX_SOURCES_PER_RUN,64);
  assert.equal(policy.dueMode,"active-result");
  assert.equal(policy.activeMinutes,30);
  assert.match(policy.where,/t\.sport='basketball'/);
  assert.match(policy.where,/t\.gender='boys'/);
  assert.match(policy.where,/t\.gender='girls'/);
  assert.doesNotMatch(policy.where,/football/);
  assert.doesNotMatch(policy.where,/volleyball/);
  assert.match(policy.gameWindow,/basketball/);
  assert.match(policy.gameWindow,/-120 minutes/);
  assert.match(policy.gameWindow,/-900 minutes/);
});

test("October live fallback can cover volleyball and both basketball genders without free-form SQL",()=>{
  const liveStatewideSports=["volleyball-girls","basketball-boys","basketball-girls","not-a-real-sport"];
  const plan={kind:"statewide-live-results",liveStatewideSports};
  assert.equal(officialFinalResultsScope(plan),"high-school-live-final-results");
  const policy=scopePolicy({scope:"high-school-live-final-results",liveStatewideSports});
  assert.match(policy.where,/volleyball/);
  assert.match(policy.where,/basketball/);
  assert.doesNotMatch(policy.where,/not-a-real-sport/);
  assert.match(policy.gameWindow,/-90 minutes/);
  assert.match(policy.gameWindow,/-120 minutes/);
});

test("live official fallback fails closed when no supported sport key is supplied",()=>{
  assert.equal(scopePolicy({scope:"high-school-live-final-results",liveStatewideSports:["not-a-real-sport"]}),null);
});

test("broad live windows remain on the high-school three-sport selector",()=>{
  assert.equal(officialFinalResultsScope({kind:"friday-football-results",liveStatewideSports:["volleyball-girls"]}),"high-school-final-results");
  assert.equal(officialFinalResultsScope({kind:"morning-results"}),"high-school-final-results");

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
