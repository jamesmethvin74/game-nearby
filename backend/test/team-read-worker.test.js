import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const teamRead = await readFile(new URL("../src/team-read-worker.js", import.meta.url), "utf8");
const standingsWorker = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");

test("team schedule and record GETs are read-only", () => {
  assert.match(teamRead, /\/api\/v1\/teams\//);
  assert.match(teamRead, /\/schedule\$\/\)/);
  assert.match(teamRead, /\/record\$\/\)/);
  assert.match(teamRead, /SELECT \* FROM team_records WHERE team_id=\?/);
  assert.doesNotMatch(teamRead, /rebuildTeamRecord/);
  assert.doesNotMatch(teamRead, /recalculateRecord/);
  assert.doesNotMatch(teamRead, /INSERT INTO team_records/);
  assert.doesNotMatch(teamRead, /UPDATE team_records/);
});

test("public Worker routes team detail through the read-only layer", () => {
  assert.match(standingsWorker, /import app from "\.\/team-read-worker\.js"/);
});
