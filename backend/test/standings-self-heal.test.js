import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("standings GET recovery is read-only and bounded to the displayed volleyball roster", async () => {
  const standings = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");
  const volleyball = await readFile(new URL("../src/volleyball-standings-overlay.js", import.meta.url), "utf8");

  // Public reads must never repair persistent records or standings. Those writes
  // belong to authoritative ingest so opening the Standings page cannot spend D1.
  assert.doesNotMatch(standings, /rebuildTeamRecords/);
  assert.doesNotMatch(standings, /rebuildMissingCalculatedConference/);
  assert.doesNotMatch(standings, /rebuildStatewideRecords/);
  assert.match(standings, /loadMaterializedCalculatedStandings/);
  assert.match(standings, /overlayVolleyballLiveRecords/);

  // Volleyball conference membership comes from the published roster. Both D1
  // reads are set-based and restricted to the aliases/team IDs on that one table.
  assert.match(volleyball, /a\.normalized_alias IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(volleyball, /cem\.reporting_team_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(volleyball, /ce\.home_school_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(volleyball, /ce\.away_school_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.doesNotMatch(volleyball, /INSERT|UPDATE|DELETE/i);
});
