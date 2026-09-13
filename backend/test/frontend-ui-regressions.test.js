import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const follow = await readFile(new URL("../../school-follow-logic.js", import.meta.url), "utf8");
const live = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const detail = await readFile(new URL("../../team-detail.js", import.meta.url), "utf8");
const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
const schoolSchedule = await readFile(new URL("../../school-schedule.js", import.meta.url), "utf8");

test("home only renders games involving followed schools", () => {
  assert.match(follow, /\.filter\(isFollowedSchoolEvent\)/);
  assert.match(follow, /getNearbyEvents/);
  assert.match(follow, /More from your teams/);
});

test("home cards orient canonical games to the school the user follows", () => {
  assert.match(follow, /function orientEventToFollowedSchool/);
  assert.match(follow, /canonicalHomeSchoolId/);
  assert.match(follow, /canonicalAwaySchoolId/);
  assert.match(follow, /\.map\(orientEventToFollowedSchool\)/);
});

test("team search uses an explicit display-none filter class", () => {
  assert.match(follow, /team-choice-filtered\{display:none!important\}/);
  assert.match(follow, /classList\.toggle\("team-choice-filtered"/);
  assert.match(follow, /addEventListener\("input", apply\)/);
});

test("nearby refresh and full team schedules are separate data paths", () => {
  assert.match(live, /const nearbyEvents = \[\]/);
  assert.doesNotMatch(live, /events\.splice\(0, events\.length, \.\.\.mapped\)/);
  assert.match(live, /fetchTeamSchedule/);
  assert.match(live, /\/api\/v1\/teams\/\$\{encodeURIComponent\(teamId\)\}\/schedule/);
  assert.match(detail, /LocalBleachersLive\?\.fetchTeamSchedule/);
  assert.match(detail, /Loading full schedule/);
});

test("team detail uses one explicit school schedule read and preserves backend sport identity", () => {
  assert.match(schoolSchedule, /\/api\/v1\/schools\/\$\{encodeURIComponent\(school\.id\)\}\/schedule/);
  assert.match(schoolSchedule, /const sport = String\(game\.sport \|\| ""\)/);
  assert.match(schoolSchedule, /const gender = String\(game\.gender \|\| ""\)/);
  assert.match(schoolSchedule, /backendTeamId:game\.reporting_team_id \|\| game\.team_id \|\| null/);
  assert.doesNotMatch(schoolSchedule, /MAX_TEAM_ENDPOINTS_PER_OPEN/);
  assert.doesNotMatch(schoolSchedule, /-mens-soccer-|\-womens-soccer-|\-volleyball-\$\{season\}/);
});

test("team detail schedule cache is versioned by season and abandons pre-status payloads", () => {
  assert.match(schoolSchedule, /localBleachersAR:teamSchedule:v3:/);
  assert.match(schoolSchedule, /\$\{SCHEDULE_CACHE_PREFIX\}\$\{currentSeason\(\)\}:\$\{schoolId\}/);
});

test("live schedule sources override the legacy MaxPreps label", () => {
  assert.match(live, /scheduleSourceLabel/);
  assert.match(live, /Arkansas varsity schedule/);
  assert.match(live, /legacyPolishedSourceLabel/);
  assert.match(live, /event\.sourceLabel \|\| legacyPolishedSourceLabel\(event\)/);
});

test("team detail renders the unified backend record and standings contract", async () => {
  assert.doesNotMatch(polish, /const TEAM_STATUS/);
  assert.match(schoolSchedule, /payload\?\.team_statuses/);
  assert.match(schoolSchedule, /live\.getTeamStatus/);
  assert.match(detail, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(detail, /status\.overall_record/);
  assert.match(detail, /status\.conference_record/);
  assert.match(detail, /status\.rank/);
});

test("home cards consume the same unified team status and prime only followed schools that are nearby", () => {
  assert.match(polish, /LocalBleachersLive\?\.getTeamStatus\?\.\(event\.teamId,event\.sport,event\.gender\)/);
  assert.match(polish, /unified\.rank/);
  assert.match(schoolSchedule, /function primeVisibleFollowedStatuses/);
  assert.match(schoolSchedule, /followedIds\.has\(id\)/);
  assert.match(schoolSchedule, /await live\.fetchTeamSchedule\(schoolId\)/);
  assert.match(schoolSchedule, /localbleachers:nearby-games/);
});

test("fallback schedules never poison the authoritative team-status memory cache", () => {
  assert.match(schoolSchedule, /memoryCache\.has\(cacheKey\) && cachedStatuses\.length/);
  assert.match(schoolSchedule, /if \(restored\.statuses\.length\)/);
  assert.match(schoolSchedule, /if \(unique\.length \|\| payload\.statuses\.length\)/);
  assert.doesNotMatch(schoolSchedule, /memoryCache\.set\(cacheKey, fallback\)/);
});
