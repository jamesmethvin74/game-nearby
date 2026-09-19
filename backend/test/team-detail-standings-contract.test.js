import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const detail = await readFile(new URL("../../team-detail.js", import.meta.url), "utf8");
const schedule = await readFile(new URL("../../school-schedule.js", import.meta.url), "utf8");
const standingsHtml = await readFile(new URL("../../standings.html", import.meta.url), "utf8");
const presentation = await readFile(new URL("../../presentation-status.js", import.meta.url), "utf8");

test("team detail consumes unified backend team status instead of fetching standings itself", () => {
  assert.doesNotMatch(detail, /\/api\/v1\/standings/);
  assert.doesNotMatch(detail, /standingsCache|standingsRequests|loadCurrentStanding|applyLiveStanding/);
  assert.match(detail, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(schedule, /payload\?\.team_statuses/);
  assert.match(schedule, /live\.getTeamStatus\s*=/);
});

test("team detail renders factual presentation fields through the shared client contract", () => {
  assert.match(detail, /LocalBleachersPresentation\?\.teamStatus/);
  assert.match(presentation, /status\.display_overall_record \?\? status\.overall_record/);
  assert.match(presentation, /status\.display_conference_record \?\? status\.conference_record/);
  assert.match(presentation, /status\.display_rank \?\? status\.rank/);
  assert.match(presentation, /gamesInRecord\(conference\) > 0/);
  assert.doesNotMatch(detail, /"N\/A"/);
});

test("standings page does not present request retrieval time as an update timestamp", () => {
  assert.match(standingsHtml, /id="standingsUpdated"[^>]*hidden[^>]*aria-hidden="true"/);
});


test("batched home status hydration honors backend school-id resolutions", () => {
  assert.match(schedule, /payload\?\.school_id_resolutions/);
  assert.match(schedule, /resolutions\.get\(schoolId\) \|\| schoolId/);
  assert.match(schedule, /setStatuses\(schoolId, schoolStatuses\)/);
  assert.match(schedule, /setStatuses\(resolvedSchoolId, schoolStatuses\)/);
});
