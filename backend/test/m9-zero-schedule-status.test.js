import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/m4-public-worker.js", import.meta.url), "utf8");

test("school status keeps active teams even before their first schedule row", () => {
  assert.match(source, /LEFT JOIN games g INDEXED BY idx_games_team_record_lookup ON g\.team_id=t\.id/);
  assert.match(source, /LEFT JOIN sources src ON src\.id=g\.source_id/);
  assert.match(source, /const resolvedRows = attachScheduleDerivedRecords/);
  assert.match(source, /buildUnifiedTeamStatuses\(env, resolvedRows\)/);
  assert.match(source, /resolvedRows\.filter\(row => Boolean\(row\.id\)/);
});
