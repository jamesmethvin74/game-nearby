import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/m8-final-audit-worker.js", import.meta.url), "utf8");
const audit = await readFile(new URL("../src/statewide-data-integrity-audit.js", import.meta.url), "utf8");

test("statewide data-integrity audit is protected, manual, all-team, and read-only", () => {
  assert.match(worker, /const DATA_INTEGRITY_VIEW="data-integrity"/);
  assert.match(worker, /coverageView===RECORD_TRUTH_VIEW \|\| coverageView===DATA_INTEGRITY_VIEW/);
  assert.match(worker, /!authorizedAudit\(request,env\)/);
  assert.match(worker, /buildStatewideDataIntegrityAudit\(env,\{season:"2026",sampleLimit:100\}\)/);
  assert.match(worker, /"cache-control":"no-store"/);
  assert.doesNotMatch(worker, /access-control-allow-origin/);

  assert.match(audit, /WHERE t\.active=1 AND t\.season=\? AND sch\.catalog_scope='local'/);
  assert.match(audit, /LEFT JOIN games g INDEXED BY idx_games_team_time ON g\.team_id=at\.team_id/);
  assert.match(audit, /SPLIT_CANONICAL_LOGICAL_GAME/);
  assert.match(audit, /STALE_NONTERMINAL_TWIN_OF_FINAL/);
  assert.match(audit, /DUPLICATE_SCHEDULE_ENTRY/);
  assert.match(audit, /DISPLAY_FINAL_MISSING_SCORE/);
  assert.doesNotMatch(audit, /INSERT\s|UPDATE\s|DELETE\s/i);
});
