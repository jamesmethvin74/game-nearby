import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/team-read-worker.js",import.meta.url),"utf8");

test("team schedule uses the same shared-conference inference as record rebuild",()=>{
  assert.match(source,/AS effective_conference_game/);
  assert.match(source,/ot\.conference_id=rt\.conference_id/);
  assert.match(source,/conference_game:\s*Number\(row\.effective_conference_game \?\? row\.conference_game/);
  assert.match(source,/ce\.home_school_id=rt\.school_id/);
  assert.match(source,/ce\.away_school_id=rt\.school_id/);
});
