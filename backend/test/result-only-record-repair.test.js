import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RESULT_ONLY_RECORD_REBUILD_MAX_TEAMS } from "../src/result-only-record-repair.js";

test("result-only record repair is bounded to the result-source cohort",()=>{
  assert.equal(RESULT_ONLY_RECORD_REBUILD_MAX_TEAMS,128);
  const source=fs.readFileSync(new URL("../src/result-only-record-repair.js",import.meta.url),"utf8");
  assert.match(source,/sch\.level='high-school'/);
  assert.match(source,/src\.source_type,''\)\)='official-school'/);
  assert.match(source,/mascot-media/);
  assert.match(source,/rankone-public/);
  assert.match(source,/rebuildTeamRecords\(env, plan\.team_ids/);
});

test("protected Worker exposes only the bounded rebuild route",()=>{
  const source=fs.readFileSync(new URL("../src/m4-public-worker.js",import.meta.url),"utf8");
  assert.match(source,/RESULT_ONLY_RECORD_REBUILD_PATH/);
  assert.match(source,/authorizedWrite\(request, env\)/);
  assert.match(source,/executeResultOnlyRecordRepair\(env\)/);
});
