import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const follow = await readFile(new URL("../../school-follow-logic.js", import.meta.url), "utf8");
const live = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const detail = await readFile(new URL("../../team-detail.js", import.meta.url), "utf8");
const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
const schoolSchedule = await readFile(new URL("../../school-schedule.js", import.meta.url), "utf8");
const standings = await readFile(new URL("../../standings.js", import.meta.url), "utf8");

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

test("team detail schedule cache is versioned by season and abandons pre-M12 truth payloads", () => {
  assert.match(schoolSchedule, /localBleachersAR:teamSchedule:v5:/);
  assert.match(schoolSchedule, /\$\{SCHEDULE_CACHE_PREFIX\}\$\{currentSeason\(\)\}:\$\{schoolId\}/);
});

test("live schedule sources override the legacy MaxPreps label", () => {
  assert.match(live, /scheduleSourceLabel/);
  assert.match(live, /Arkansas varsity schedule/);
  assert.match(live, /legacyPolishedSourceLabel/);
  assert.match(live, /event\.sourceLabel \|\| legacyPolishedSourceLabel\(event\)/);
});

test("team detail and home cards read the same canonical presentation-status store", () => {
  assert.doesNotMatch(polish, /const TEAM_STATUS/);
  assert.match(schoolSchedule, /payload\?\.team_statuses/);
  assert.match(schoolSchedule, /ingestPresentationStatuses/);
  assert.doesNotMatch(schoolSchedule, /const statusCache = new Map\(\)/);
  assert.match(polish, /LocalBleachersLive\?\.getPresentationStatus/);
  assert.match(detail, /LocalBleachersLive\?\.getPresentationStatus/);
  assert.match(detail, /LocalBleachersPresentation\?\.teamStatus/);
  assert.doesNotMatch(detail, /selectedEvents\.find\(event => event\.record\)/);
});

test("home refresh primes canonical truth for every followed school rendered on a card without statewide fan-out", () => {
  assert.doesNotMatch(polish, /event\?\.presentationStatus/);
  assert.match(polish, /LocalBleachersPresentation\?\.teamStatus/);
  assert.doesNotMatch(polish, /TEAM_CONFERENCE_FALLBACKS/);
  assert.match(live, /presentationSchoolIdsForGames/);
  assert.match(live, /if \(selected\.length\) return selected/);
  assert.match(live, /games\.map\(game => String\(game\?\.school_id \|\| ""\)\)/);
  assert.doesNotMatch(live, /game\?\.canonical_home_school_id/);
  assert.doesNotMatch(live, /game\?\.canonical_away_school_id/);
  assert.match(live, /fetchPresentationStatusSnapshot/);
  assert.match(live, /replaceCanonicalPresentationStatuses\(presentationStatuses\)/);
  assert.match(live, /if \(requestId !== state\.nearbyRequest\) return state\.nearbyCount;[\s\S]*replaceCanonicalPresentationStatuses\(presentationStatuses\)/);
  assert.match(live, /const PRESENTATION_STATUS_BATCH_SIZE = 4/);
  assert.match(live, /offset \+= PRESENTATION_STATUS_BATCH_SIZE/);
  assert.match(live, /Promise\.all\(chunks\.map\(chunk => fetchPresentationStatusChunk\(snapshot, chunk\)\)\)/);
  assert.match(live, /Promise\.all\(\[[\s\S]*fetchPresentationStatusChunk\(snapshot, chunk\.slice\(0, middle\)\)[\s\S]*fetchPresentationStatusChunk\(snapshot, chunk\.slice\(middle\)\)/);
  assert.match(live, /\/api\/v1\/team-statuses\?/);
  assert.match(live, /getPresentationStatus/);
  assert.doesNotMatch(live, /slice\(0, 24\)/);
  assert.doesNotMatch(schoolSchedule, /localbleachers:nearby-games/);
});

test("standings render backend display fields without inventing rank or records", () => {
  assert.match(standings, /LocalBleachersPresentation\?\.standingRow/);
  assert.match(standings, /row\.display_rank \?\? row\.rank/);
  assert.match(standings, /row\.display_conference_record \?\? row\.conference_record/);
  assert.match(standings, /row\.display_overall_record \?\? row\.overall_record/);
  assert.doesNotMatch(standings, /Published standings are available only as evidence/);
  assert.doesNotMatch(standings, /row\.rank \?\? index \+ 1/);
  assert.doesNotMatch(standings, /row\.conference_record \|\| "0-0"/);
  assert.doesNotMatch(standings, /row\.overall_record \|\| "0-0"/);
});

test("fallback schedules never create or restore a second presentation-truth cache", () => {
  assert.match(schoolSchedule, /if \(memoryCache\.has\(cacheKey\)\)/);
  assert.doesNotMatch(schoolSchedule, /if \(restored\.statuses\.length\)/);
  assert.match(schoolSchedule, /if \(unique\.length \|\| payload\.statuses\.length\)/);
  assert.match(schoolSchedule, /ingestPresentationStatuses/);
  assert.doesNotMatch(schoolSchedule, /const statusCache = new Map\(\)/);
  assert.doesNotMatch(schoolSchedule, /memoryCache\.set\(cacheKey, fallback\)/);
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

test("nearby game refresh commits canonical presentation truth before rendering cards", async () => {
  const polishSource = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
  assert.match(live, /fetchNearbyPresentationStatuses/);
  assert.match(live, /\/api\/v1\/team-statuses\?/);
  assert.doesNotMatch(live, /presentationStatus:/);
  assert.match(live, /replaceCanonicalPresentationStatuses\(presentationStatuses\);[\s\S]*applyNearbyGames\(payload\.games\)/);
  assert.match(polishSource, /LocalBleachersLive\?\.getPresentationStatus/);
  assert.doesNotMatch(polishSource, /event\?\.presentationStatus/);
});

test("home card fallback record formatting is self-contained", async () => {
  const polishSource = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
  assert.match(polishSource, /function recordLabel\(/);
  assert.match(polishSource, /overall: recordLabel\(/);
});


test("home cards resolve the shared presentation object before any record fallback", async () => {
  const polishSource = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
  assert.match(polishSource, /LocalBleachersLive\?\.getPresentationStatus/);
  assert.doesNotMatch(polishSource, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(polishSource, /const registrySchool = typeof SCHOOL_REGISTRY !== "undefined"/);
  assert.match(polishSource, /registrySchool\?\.level \|\| event\?\.level/);
  assert.match(polishSource, /\["high-school","highschool"\]\.includes\(normalizedLevel\)/);
  assert.match(polishSource, /\["football","volleyball","basketball"\]/);
  assert.match(polishSource, /if \(requiresPresentationTruth\) \{/);
});


test("nearby games and followed-team presentation truth load concurrently", () => {
  assert.match(live, /const gamesPromise = fetchJson\(/);
  assert.match(live, /const earlyStatusPromise = followedSchoolIds\.length/);
  assert.match(live, /fetchPresentationStatusSnapshot\(followedSchoolIds\)/);
  assert.match(live, /const payload = await gamesPromise/);
  assert.match(live, /earlyStatusPromise[\s\S]*await earlyStatusPromise/);
});
