import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PRESENTATION_SUPPRESSED_NOTE,
  currentScheduleTruthSql,
  hasPresentationSuppressedMarker
} from "../src/current-schedule-truth.js";

test("presentation suppression marker is explicit and reusable",()=>{
  assert.equal(PRESENTATION_SUPPRESSED_NOTE,"Excluded from current LocalBleachers presentation");
  assert.equal(hasPresentationSuppressedMarker({notes:`old note | ${PRESENTATION_SUPPRESSED_NOTE}`}),true);
  const sql=currentScheduleTruthSql("g","src");
  assert.match(sql,/Excluded from current LocalBleachers presentation/);
  assert.match(sql,/Removed from current statewide DragonFly schedule/);
});

test("all app schedule surfaces apply current schedule truth",()=>{
  const team=fs.readFileSync(new URL("../src/team-read-worker.js",import.meta.url),"utf8");
  const nearby=fs.readFileSync(new URL("../src/canonical-game-read-worker.js",import.meta.url),"utf8");
  const audit=fs.readFileSync(new URL("../src/statewide-data-integrity-audit.js",import.meta.url),"utf8");
  assert.match(team,/currentScheduleTruthSql\("g","s"\)/);
  assert.match(nearby,/currentScheduleTruthSql\("g","src"\)/);
  assert.match(nearby,/currentScheduleTruthSql\("gvis","srcvis"\)/);
  assert.match(audit,/visible_games AS/);
  assert.match(audit,/currentScheduleTruthSql\("g","src_visible"\)/);
});

test("statewide audit preserves active teams with no visible games",()=>{
  const audit=fs.readFileSync(new URL("../src/statewide-data-integrity-audit.js",import.meta.url),"utf8");
  assert.match(audit,/LEFT JOIN visible_games g ON g\.team_id=at\.team_id/);
  assert.doesNotMatch(audit,/WHERE g\.id IS NULL OR/);
});
