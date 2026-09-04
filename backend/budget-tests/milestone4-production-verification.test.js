import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  COLLEGE_SOURCE_ACTIVATE_SQL,
  COLLEGE_SOURCE_PREPARE_SQL,
  COLLEGE_TEAM_ACTIVATION_SQL,
  collegeProductionActivationPlan
} from "../src/college-production-activation.js";
import { COLLEGE_SCHOOL_INSERT_SQL, COLLEGE_TEAM_INSERT_SQL } from "../src/college-catalog.js";
import {
  COLLEGE_PRODUCTION_VERIFICATION_SQL,
  HIGH_SCHOOL_BASELINE,
  PROTECTION_INDEXES
} from "../src/college-production-verification.js";

const migrationDir = new URL("../migrations/", import.meta.url);

function buildDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(file, migrationDir), "utf8"));
  }
  return db;
}

function prepareAndActivate(db, plan) {
  db.prepare(COLLEGE_SCHOOL_INSERT_SQL).run(JSON.stringify(plan.schools));
  db.prepare(COLLEGE_TEAM_INSERT_SQL).run(JSON.stringify(plan.teams));
  db.prepare(COLLEGE_TEAM_ACTIVATION_SQL).run(JSON.stringify(plan.certifiedTargets), JSON.stringify(plan.teams));
  db.prepare(COLLEGE_SOURCE_PREPARE_SQL).run(JSON.stringify(plan.sourceRows));
  db.prepare(COLLEGE_SOURCE_ACTIVATE_SQL).run(JSON.stringify(plan.sourceRows), JSON.stringify(plan.teams));
}

test("M4 source activation enables exactly the certified URL+parser authority for target teams", () => {
  const db = buildDb();
  const plan = collegeProductionActivationPlan("2026");
  prepareAndActivate(db, plan);

  const enabledCollegeTargets = Number(db.prepare(`
    SELECT COUNT(DISTINCT t.id) n
    FROM teams t JOIN schools s ON s.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.enabled=1
    WHERE s.level='college' AND s.catalog_scope='local' AND t.season='2026'
  `).get().n);
  assert.equal(enabledCollegeTargets, plan.counts.ready);

  const enabledInactive = Number(db.prepare(`
    SELECT COUNT(*) n FROM sources src JOIN teams t ON t.id=src.team_id
    WHERE src.enabled=1 AND t.active=0 AND t.season='2026'
  `).get().n);
  assert.equal(enabledInactive, 0);
});

test("M4 combined production verification is one read-only statement and matches prepared source/catalog state", () => {
  const db = buildDb();
  const plan = collegeProductionActivationPlan("2026");
  const highSchoolBefore = Number(db.prepare(`
    SELECT COUNT(*) n
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE s.level='high-school' AND s.catalog_scope='local' AND t.active=1
  `).get().n);
  prepareAndActivate(db, plan);
  const seasonStart = "2026-07-01T00:00:00.000Z";
  const row = db.prepare(COLLEGE_PRODUCTION_VERIFICATION_SQL).get(
    JSON.stringify(plan.schools),
    JSON.stringify(plan.teams),
    JSON.stringify(plan.certifiedTargets),
    JSON.stringify(plan.sourceRows),
    seasonStart,seasonStart,seasonStart,seasonStart,
    ...PROTECTION_INDEXES
  );

  assert.equal(Number(row.college_schools_present), plan.counts.schools);
  assert.equal(Number(row.college_targets_present), plan.counts.teams);
  assert.equal(Number(row.certified_teams_active), plan.counts.ready);
  assert.equal(Number(row.inactive_targets), plan.counts.inactive);
  assert.equal(Number(row.certified_source_targets_present), plan.counts.ready);
  assert.equal(Number(row.certified_source_targets_enabled), plan.counts.ready);
  assert.equal(Number(row.inactive_target_source_rows), 0);
  assert.equal(Number(row.unexpected_enabled_certified_sources), 0);
  assert.equal(Number(row.stale_prior_season_observations), 0);
  assert.equal(Number(row.protection_indexes_present), PROTECTION_INDEXES.length);
  assert.equal(Number(row.high_school_active_teams), highSchoolBefore, "M4 must not change the high-school fixture baseline");
  assert.equal(HIGH_SCHOOL_BASELINE, 1102, "production verification remains locked to the certified M2 baseline");
  assert.equal(Number(row.current_college_observations), 0, "schedule ingestion is intentionally a later production step");

  assert.doesNotMatch(COLLEGE_PRODUCTION_VERIFICATION_SQL, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});
