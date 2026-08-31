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
