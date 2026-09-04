import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  COLLEGE_SOURCE_PREPARE_SQL,
  COLLEGE_TEAM_ACTIVATION_SQL,
  collegeProductionActivationPlan
} from "../src/college-production-activation.js";
import { COLLEGE_SCHOOL_INSERT_SQL, COLLEGE_TEAM_INSERT_SQL } from "../src/college-catalog.js";

const migrationDir = new URL("../migrations/", import.meta.url);

function buildDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(file, migrationDir), "utf8"));
  }
  return db;
}

function count(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params).n);
}

test("M4 activation plan uses only the currently live-proved college denominator", () => {
  const plan = collegeProductionActivationPlan("2026");
  assert.equal(plan.counts.schools, 36);
  assert.equal(plan.counts.teams, 130);
  assert.equal(plan.counts.ready, 102);
  assert.equal(plan.counts.pending, 9);
  assert.equal(plan.counts.blocked, 19);
  assert.equal(plan.counts.inactive, 28);
  assert.equal(plan.counts.sourceRows, 102);
  assert.equal(new Set(plan.certifiedTargets.map(row => `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`)).size, 102);
  assert.equal(plan.certifiedTargets.some(row => row.schoolId === "cbc" && row.sport === "basketball" && row.gender === "men"), false);
});

test("M4 prep materializes the full catalog but activates only certified college teams", () => {
  const db = buildDb();
  const plan = collegeProductionActivationPlan("2026");
  const highSchoolBefore = count(db, "SELECT COUNT(*) n FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.level='high-school'");

  db.prepare(COLLEGE_SCHOOL_INSERT_SQL).run(JSON.stringify(plan.schools));
  db.prepare(COLLEGE_TEAM_INSERT_SQL).run(JSON.stringify(plan.teams));
  db.prepare(COLLEGE_TEAM_ACTIVATION_SQL).run(JSON.stringify(plan.certifiedTargets), JSON.stringify(plan.teams));

  assert.equal(count(db, "SELECT COUNT(*) n FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.level='college' AND t.season='2026' AND t.active=1"), 102);
  assert.equal(count(db, "SELECT COUNT(*) n FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.level='college' AND t.season='2026' AND t.active=0"), 28);
  assert.equal(count(db, "SELECT COUNT(*) n FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.level='high-school'"), highSchoolBefore);
});

test("M4 source prep is set-based, disabled, idempotent, and reuses equivalent pilot sources", () => {
  const db = buildDb();
  const plan = collegeProductionActivationPlan("2026");
  db.prepare(COLLEGE_SCHOOL_INSERT_SQL).run(JSON.stringify(plan.schools));
  db.prepare(COLLEGE_TEAM_INSERT_SQL).run(JSON.stringify(plan.teams));
  db.prepare(COLLEGE_TEAM_ACTIVATION_SQL).run(JSON.stringify(plan.certifiedTargets), JSON.stringify(plan.teams));

  const beforePilotSources = count(db, "SELECT COUNT(*) n FROM sources WHERE id IN ('uca-football-official','uca-mens-soccer-official','hendrix-football-official')");
  assert.equal(beforePilotSources, 3);

  const first = db.prepare(COLLEGE_SOURCE_PREPARE_SQL).run(JSON.stringify(plan.sourceRows));
  const preparedAfterFirst = count(db, "SELECT COUNT(*) n FROM sources WHERE id LIKE 'college-%'");
  assert.ok(Number(first.changes) > 0);
  assert.ok(preparedAfterFirst < plan.counts.sourceRows, "equivalent pilot sources should not be duplicated");
  assert.equal(count(db, "SELECT COUNT(*) n FROM sources WHERE id LIKE 'college-%' AND enabled=1"), 0);

  const second = db.prepare(COLLEGE_SOURCE_PREPARE_SQL).run(JSON.stringify(plan.sourceRows));
  assert.equal(Number(second.changes), 0);
  assert.equal(count(db, "SELECT COUNT(*) n FROM sources WHERE id LIKE 'college-%'"), preparedAfterFirst);
  assert.equal(count(db, "SELECT COUNT(*) n FROM sources WHERE id IN ('uca-football-official','uca-mens-soccer-official','hendrix-football-official')"), 3);
});

test("M4 prep SQL cannot mutate games, records, standings, or high-school rows", () => {
  const sql = `${COLLEGE_TEAM_ACTIVATION_SQL}\n${COLLEGE_SOURCE_PREPARE_SQL}`.replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\s+(?:OR\s+IGNORE\s+)?(?:INTO\s+)?(?:games|canonical_events|canonical_event_members|team_records|standings)\b/i);
  assert.match(COLLEGE_TEAM_ACTIVATION_SQL, /FROM json_each\(\?\)/);
  assert.match(COLLEGE_SOURCE_PREPARE_SQL, /WHERE NOT EXISTS/);
  assert.match(COLLEGE_SOURCE_PREPARE_SQL, /enabled,authority_rank/);
});
