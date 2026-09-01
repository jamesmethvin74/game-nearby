import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const follow = await readFile(new URL("../../school-follow-logic.js", import.meta.url), "utf8");
const live = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const detail = await readFile(new URL("../../team-detail.js", import.meta.url), "utf8");

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

test("live schedule sources override the legacy MaxPreps label", () => {
  assert.match(live, /scheduleSourceLabel/);
  assert.match(live, /Arkansas varsity schedule/);
  assert.match(live, /legacyPolishedSourceLabel/);
  assert.match(live, /event\.sourceLabel \|\| legacyPolishedSourceLabel\(event\)/);
});


test("live calculated records replace the old hardcoded 0-0 status table", async () => {
  const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
  assert.doesNotMatch(polish, /const TEAM_STATUS/);
  assert.match(polish, /event\.record/);
  assert.match(polish, /recordLabel\(record\.wins,record\.losses,record\.ties\)/);
  assert.match(live, /normalizeRecord/);
  assert.match(live, /recordOverride/);
  assert.match(detail, /selectedEvents\.find\(event => event\.record\)/);
});
