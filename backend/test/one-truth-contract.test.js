import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const truth=fs.readFileSync(new URL("../src/one-truth.js",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../src/one-truth-worker.js",import.meta.url),"utf8");
const top=fs.readFileSync(new URL("../src/m8-final-audit-worker.js",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../migrations/0017_one_truth_tb.sql",import.meta.url),"utf8");

test("ONE_TRUTH_TB is the final presentation read model",()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS ONE_TRUTH_TB/);
  assert.match(truth,/const TABLE = "ONE_TRUTH_TB"/);
  assert.match(truth,/currentObservationEvidenceSql\("g","src"\)/);
  assert.match(truth,/enrichScheduleRowsWithResultEvidence/);
  assert.match(truth,/officialSeasonScheduleRows\(resolved\)/);
  assert.match(truth,/rowIsCollegePreseasonGhost/);
  assert.match(truth,/rankSummaries\(summaries\)/);
  assert.match(worker,/x-localbleachers-truth":"ONE_TRUTH_TB"/);
});

test("all user-facing result surfaces route through ONE_TRUTH_TB",()=>{
  assert.match(top,/import app from "\.\/one-truth-worker\.js"/);
  assert.match(worker,/path==="\/api\/v1\/games"/);
  assert.match(worker,/path==="\/api\/v1\/team-statuses"/);
  assert.match(worker,/schools\\\/\[\^\/\]\+\\\/schedule/);
  assert.match(worker,/teams\\\/\[\^\/\]\+\\\/\(\?:schedule\|record\)/);
  assert.match(worker,/path==="\/api\/v1\/standings"/);
  assert.doesNotMatch(worker,/display_method:"published"/);
});

test("records in ONE_TRUTH_TB are calculated only from visible countable finals",()=>{
  assert.match(truth,/Number\(game\.counts_for_record \?\? 1\) === 0/);
  assert.match(truth,/String\(game\.status \|\| ""\)\.toUpperCase\(\) !== "FINAL"/);
  assert.match(truth,/overall_record:record\.scored_finals \? recordText/);
  assert.match(truth,/conference_record:team\.conference_id/);
});


test("ONE_TRUTH_TB conference truth does not depend on rebuild batch composition",()=>{
  assert.match(truth,/COALESCE\(ocm\.conference_id,ot\.conference_id\) AS opponent_conference_id/);
  assert.match(truth,/row\.opponent_conference_id/);
  assert.match(truth,/refreshRanksForCohorts\(env, summaries\)/);
  assert.doesNotMatch(truth,/rankSummaries\(summaries\);/);
});

test("canonical authority keeps complete final evidence before incomplete higher-authority observations",()=>{
  assert.match(truth,/ce\.home_score IS NOT NULL/);
  assert.match(truth,/ce\.away_score IS NOT NULL/);
  assert.match(truth,/g\.team_score IS NOT NULL/);
  assert.match(truth,/g\.opponent_score IS NOT NULL/);
  assert.match(truth,/src\.authority_rank,src\.source_priority,src\.id/);
});


test("unverified finals are never presented as FINAL",()=>{
  assert.match(truth,/presentationPending = finalIsUnverified \|\| pastDueNonterminal/);
  assert.match(truth,/presentationStatus = presentationPending \? "RESULT_PENDING"/);
  assert.match(truth,/presentationTeamScore = finalIsUnverified \? null/);
  assert.match(truth,/presentationOpponentScore = finalIsUnverified \? null/);
  assert.match(truth,/result:presentationPending \? null/);
});


test("past-due scheduled games are presented as result pending",()=>{
  assert.match(truth,/PAST_DUE_PENDING_HOURS = 6/);
  assert.match(truth,/pastDueNonterminal/);
  assert.match(truth,/presentationPending = finalIsUnverified \|\| pastDueNonterminal/);
  assert.match(truth,/presentationStatus = presentationPending \? "RESULT_PENDING"/);
  assert.match(truth,/result:presentationPending \? null/);
});


test("standings are served directly from ONE_TRUTH without legacy upstream dependency",()=>{
  const start=worker.indexOf("async function standingsResponse");
  const end=worker.indexOf("\nexport default {",start);
  const block=worker.slice(start,end);
  assert.ok(start>=0);
  assert.doesNotMatch(block,/app\.fetch\(/);
  assert.match(block,/FROM \$\{TABLE\}/);
  assert.match(block,/team_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(block,/JSON\.stringify\(teamIds\)/);
  assert.match(block,/standings_method:"one-truth"/);
});


test("conference slug resolves directly from ONE_TRUTH canonical conference values",()=>{
  const start=worker.indexOf("async function teamIdsForConference");
  const end=worker.indexOf("async function nearbyTeamIds",start);
  const block=worker.slice(start,end);
  assert.match(block,/FROM \$\{TABLE\}/);
  assert.match(block,/conference_membership_state='member'/);
  assert.match(block,/conferenceSlugMatches\(row\.conference_id,candidates\)/);
  assert.match(block,/conferenceSlugMatches\(row\.conference_name,candidates\)/);
  assert.doesNotMatch(block,/conference_memberships|FROM teams|JOIN conferences/);
});
