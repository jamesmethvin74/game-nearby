import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("standings GET recovery is read-only and roster-bounded through the shared truth resolver", async () => {
  const standings = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");
  const volleyball = await readFile(new URL("../src/volleyball-standings-overlay.js", import.meta.url), "utf8");

  assert.doesNotMatch(standings, /rebuildTeamRecords/);
  assert.doesNotMatch(standings, /rebuildMissingCalculatedConference/);
  assert.doesNotMatch(standings, /rebuildStatewideRecords/);
  assert.match(standings, /loadStandingsTruth/);

  assert.match(volleyball, /a\.normalized_alias IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(volleyball, /cem\.reporting_team_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(volleyball, /ce\.home_school_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(volleyball, /ce\.away_school_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.doesNotMatch(volleyball, /INSERT|UPDATE|DELETE/i);
});
