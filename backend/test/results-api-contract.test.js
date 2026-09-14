import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const live = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");

test("team schedule and record routes recalculate from the shared result engine", () => {
  assert.match(index, /rebuildTeamRecord/);
  assert.match(index, /await recalculateRecord\(env,teamId\)/);
  assert.match(index, /return json\(\{teamId,games,record:/);
});

test("frontend consumes unified verified team status instead of deriving a competing record", () => {
  assert.match(live, /payload\?\.team_statuses/);
  assert.match(live, /applyTeamStatuses\(schoolId, payload\.team_statuses\)/);
  assert.match(live, /status\.record_verified === false \? null : \(status\.overall_record \|\| null\)/);
  assert.match(live, /record_state: status\.record_state \|\| null/);
  assert.match(live, /record_issues: Array\.isArray\(status\.record_issues\)/);
  assert.doesNotMatch(live, /const record = normalizeRecord\(payload\?\.record\)/);
  assert.doesNotMatch(polish, /const TEAM_STATUS/);
  assert.match(polish, /overall:recordLabel\(record\.wins,record\.losses,record\.ties\)/);
});
