import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  PRESENTATION_SUPPRESSED_NOTE,
  currentScheduleTruthSql,
  hasPresentationSuppressedMarker,
  suppressionPreservingNotesSql
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


test("unchanged stale refresh preserves suppression but terminal or future truth can replace it",()=>{
  const sql=suppressionPreservingNotesSql("games","excluded");
  assert.match(sql,/Excluded from current LocalBleachers presentation/);
  assert.match(sql,/excluded\.status/);
  assert.match(sql,/='SCHEDULED'/);
  assert.match(sql,/datetime\('now','-6 hours'\)/);

  const canonicalWriter=fs.readFileSync(new URL("../src/canonical-observation-writer.js",import.meta.url),"utf8");
  const statewideWriter=fs.readFileSync(new URL("../src/dragonfly-statewide.js",import.meta.url),"utf8");
  assert.match(canonicalWriter,/suppressionPreservingNotesSql\("games","excluded"\)/);
  assert.match(statewideWriter,/suppressionPreservingNotesSql\("games","excluded"\)/);
});


test("suppression SQL survives stale upsert and clears on terminal or future reschedule",()=>{
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE games(id TEXT PRIMARY KEY,notes TEXT,status TEXT,scheduled_at TEXT)");
  db.prepare("INSERT INTO games(id,notes,status,scheduled_at) VALUES(?,?,?,?)")
    .run("g1",PRESENTATION_SUPPRESSED_NOTE,"SCHEDULED","2026-09-01T00:00:00.000Z");

  const sql=`
    INSERT INTO games(id,notes,status,scheduled_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      notes=${suppressionPreservingNotesSql("games","excluded")},
      status=excluded.status,
      scheduled_at=excluded.scheduled_at
  `;

  db.prepare(sql).run("g1","provider stale","SCHEDULED","2026-09-01T00:00:00.000Z");
  assert.match(db.prepare("SELECT notes FROM games WHERE id='g1'").get().notes,/Excluded from current LocalBleachers presentation/);

  db.prepare(sql).run("g1","provider final","FINAL","2026-09-01T00:00:00.000Z");
  assert.equal(db.prepare("SELECT notes FROM games WHERE id='g1'").get().notes,"provider final");

  db.prepare("UPDATE games SET notes=?,status='SCHEDULED',scheduled_at='2026-09-01T00:00:00.000Z' WHERE id='g1'")
    .run(PRESENTATION_SUPPRESSED_NOTE);
  db.prepare(sql).run("g1","provider rescheduled","SCHEDULED","2099-09-01T00:00:00.000Z");
  assert.equal(db.prepare("SELECT notes FROM games WHERE id='g1'").get().notes,"provider rescheduled");
});


test("records, Team Detail and standings share current schedule truth",()=>{
  const rebuild=fs.readFileSync(new URL("../src/record-rebuild.js",import.meta.url),"utf8");
  const standings=fs.readFileSync(new URL("../src/standings-truth.js",import.meta.url),"utf8");
  const status=fs.readFileSync(new URL("../src/m4-public-worker.js",import.meta.url),"utf8");
  const presentation=fs.readFileSync(new URL("../src/conference-standings-truth.js",import.meta.url),"utf8");
  assert.match(rebuild,/currentScheduleTruthSql\("mg","src"\)/);
  assert.match(rebuild,/currentScheduleTruthSql\("g","src"\)/);
  assert.ok(standings.indexOf("calculated = await loadLiveCanonicalCalculatedStandings") < standings.indexOf("calculated = await loadMaterializedCalculatedStandings"));
  assert.match(status,/display_overall_record = status\.overall_record/);
  assert.match(presentation,/display_method: row\?\.standings_verified === true \? "canonical" : "canonical-unverified"/);
});
