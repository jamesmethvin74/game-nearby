import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const detail = await readFile(new URL("../../team-detail.js", import.meta.url), "utf8");
const schedule = await readFile(new URL("../../school-schedule.js", import.meta.url), "utf8");
const standingsHtml = await readFile(new URL("../../standings.html", import.meta.url), "utf8");

test("team detail consumes unified backend team status instead of fetching standings itself", () => {
  assert.doesNotMatch(detail, /\/api\/v1\/standings/);
  assert.doesNotMatch(detail, /standingsCache|standingsRequests|loadCurrentStanding|applyLiveStanding/);
  assert.match(detail, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(schedule, /payload\?\.team_statuses/);
  assert.match(schedule, /live\.getTeamStatus\s*=/);
});

test("team detail renders factual presentation fields without N/A gates", () => {
  assert.match(detail, /status\.display_overall_record\s*\?\?\s*status\.overall_record/);
  assert.match(detail, /status\.display_conference_record\s*\?\?\s*status\.conference_record/);
  assert.match(detail, /status\.display_rank\s*\?\?\s*status\.rank/);
  assert.doesNotMatch(detail, /conferenceKnown\s*&&\s*conferenceGames\s*>\s*0/);
  assert.doesNotMatch(detail, /"N\/A"/);
  assert.match(detail, /conferenceName:\s*status\.conference_name/);
});

test("standings page does not present request retrieval time as an update timestamp", () => {
  assert.match(standingsHtml, /id="standingsUpdated"[^>]*hidden[^>]*aria-hidden="true"/);
});
