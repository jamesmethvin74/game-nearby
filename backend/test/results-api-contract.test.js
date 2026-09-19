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

test("frontend consumes backend team-status presentation before embedded record fallback", () => {
  assert.match(live, /normalizeRecord/);
  assert.match(live, /getPresentationStatus/);
  assert.doesNotMatch(polish, /const TEAM_STATUS/);
  assert.match(polish, /LocalBleachersLive\?\.getPresentationStatus/);
  assert.doesNotMatch(polish, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(polish, /LocalBleachersPresentation\?\.teamStatus/);
  assert.ok(polish.indexOf("if (factual) return factual") < polish.indexOf("const requiresPresentationTruth"));
  assert.ok(polish.indexOf("const requiresPresentationTruth") < polish.indexOf("const record = event.record || null"));
});
