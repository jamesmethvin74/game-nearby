import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  ARKANSAS_COLLEGE_SCHOOL_METADATA,
  COLLEGE_SCHOOL_INSERT_SQL,
  COLLEGE_TEAM_INSERT_SQL,
  collegeCatalogSeed
} from "../src/college-catalog.js";
import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "../src/college-team-inventory.js";

const migrationDir = new URL("../migrations/", import.meta.url);

function buildThrough(maxMigration = "0013_milestone1_complete_team_materialization.sql") {
  const db = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync(migrationDir).filter(name => name.endsWith(".sql") && name <= maxMigration).sort()) {
    db.exec(fs.readFileSync(new URL(file, migrationDir), "utf8"));
  }
  return db;
}

function applySeed(db, seed) {
  db.prepare(COLLEGE_SCHOOL_INSERT_SQL).run(JSON.stringify(seed.schools));
  db.prepare(COLLEGE_TEAM_INSERT_SQL).run(JSON.stringify(seed.teams));
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function matchedSchoolCount(db, schools) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS n
    FROM schools s
    JOIN json_each(?) expected
      ON s.id=json_extract(expected.value,'$.id')
     AND s.level='college'
     AND s.catalog_scope='local'
  `).get(JSON.stringify(schools)).n);
}

function matchedTeamCount(db, teams) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS n
    FROM teams t
    JOIN json_each(?) expected
      ON t.school_id=json_extract(expected.value,'$.schoolId')
     AND t.sport=json_extract(expected.value,'$.sport')
     AND t.gender=json_extract(expected.value,'$.gender')
     AND t.season=json_extract(expected.value,'$.season')
     AND t.active=1
  `).get(JSON.stringify(teams)).n);
}

test("M3 college catalog seed is exactly the certified 36-school / 132-team denominator", () => {
  const seed = collegeCatalogSeed("2026");
  assert.equal(seed.schools.length, 36);
  assert.equal(seed.teams.length, 132);
  assert.equal(seed.schools.filter(row => row.verificationStatus === "verified").length, 35);
  assert.equal(seed.schools.filter(row => row.verificationStatus === "provisional").length, 1);
  assert.equal(new Set(seed.schools.map(row => row.id)).size, 36);
  assert.equal(new Set(seed.teams.map(row => `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`)).size, 132);

  const inventoryIds = ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => row.schoolId).sort();
  const metadataIds = ARKANSAS_COLLEGE_SCHOOL_METADATA.map(row => row.id).sort();
  assert.deepEqual(metadataIds, inventoryIds);
});

test("M3 college catalog materializes all targets idempotently without assuming generated team IDs", () => {
  const db = buildThrough();
  const seed = collegeCatalogSeed("2026");

  applySeed(db, seed);
  assert.equal(matchedSchoolCount(db, seed.schools), 36);
  assert.equal(matchedTeamCount(db, seed.teams), 132);

  // UCA/Hendrix have pre-existing pilot team IDs. The target join deliberately
  // verifies school/sport/gender/season rather than requiring generated IDs.
  applySeed(db, seed);
  assert.equal(matchedSchoolCount(db, seed.schools), 36);
  assert.equal(matchedTeamCount(db, seed.teams), 132);

  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM teams WHERE school_id='asu-mountain-home'").get().n), 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM teams WHERE school_id='asu-three-rivers'").get().n), 0);
});

test("M3 college catalog bootstrap changes catalog only and stays two-statement/set-based", () => {
  const db = buildThrough();
  const seed = collegeCatalogSeed("2026");
  const before = {
    sources: count(db, "sources"),
    games: count(db, "games"),
    records: count(db, "team_records"),
    standings: count(db, "standings")
  };

  applySeed(db, seed);

  const after = {
    sources: count(db, "sources"),
    games: count(db, "games"),
    records: count(db, "team_records"),
    standings: count(db, "standings")
  };
  assert.deepEqual(after, before);

  const sql = `${COLLEGE_SCHOOL_INSERT_SQL}\n${COLLEGE_TEAM_INSERT_SQL}`.replace(/--.*$/gm, "");
  assert.equal((sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+schools\b/gi) || []).length, 1);
  assert.equal((sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+teams\b/gi) || []).length, 1);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\s+(?:OR\s+IGNORE\s+)?(?:INTO\s+)?(?:sources|games|team_records|standings)\b/i);
  assert.match(COLLEGE_SCHOOL_INSERT_SQL, /json_each\(\?\)/);
  assert.match(COLLEGE_TEAM_INSERT_SQL, /json_each\(\?\)/);
});
