import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const follow = await readFile(new URL("../../school-follow-logic.js", import.meta.url), "utf8");
const live = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const detail = await readFile(new URL("../../team-detail.js", import.meta.url), "utf8");
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
  assert.match(schoolSchedule, /localBleachersAR:teamSchedule:v5:/);
  assert.match(schoolSchedule, /\$\{SCHEDULE_CACHE_PREFIX\}\$\{currentSeason\(\)\}:\$\{schoolId\}/);
});

test("live schedule sources override the legacy MaxPreps label", () => {
  assert.match(live, /scheduleSourceLabel/);
  assert.match(live, /Arkansas varsity schedule/);
  assert.match(live, /legacyPolishedSourceLabel/);
  assert.match(live, /event\.sourceLabel \|\| legacyPolishedSourceLabel\(event\)/);
});

test("team detail renders the unified backend record and standings contract", async () => {
  const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
  assert.doesNotMatch(polish, /const TEAM_STATUS/);
  assert.match(schoolSchedule, /payload\?\.team_statuses/);
  assert.match(schoolSchedule, /live\.getTeamStatus/);
  assert.match(detail, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(detail, /LocalBleachersPresentation/);
  assert.match(schoolSchedule, /team_statuses/);
});


test("front cards expose the in-app schedule and results action without provider branding", async () => {
  const reference = await readFile(new URL("../../reference-layout.js", import.meta.url), "utf8");
  const polishSource = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
  assert.match(reference, /View schedule &amp; results/);
  assert.match(reference, /event-main team-detail-trigger/);
  assert.match(reference, /data-team-id=/);
  assert.doesNotMatch(reference, /source-row/);
  assert.doesNotMatch(reference, /MaxPreps schedule/);
  assert.doesNotMatch(polishSource, /MaxPreps schedule/);
  assert.match(detail, /document\.addEventListener\("keydown"/);
});

test("nearby game refresh carries factual presentation status into front cards before render", async () => {
  const polishSource = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
  assert.match(live, /fetchNearbyPresentationStatuses/);
  assert.match(live, /\/api\/v1\/team-statuses\?/);
  assert.match(live, /presentationStatus:/);
  assert.match(live, /applyNearbyGames\(payload\.games, presentationStatuses\)/);
  assert.match(polishSource, /event\?\.presentationStatus/);
});
