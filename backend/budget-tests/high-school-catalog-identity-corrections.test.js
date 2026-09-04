import test from "node:test";
import assert from "node:assert/strict";
import reconciliation from "../data/arkansas-high-school-production-reconciliation.json" with { type: "json" };
import decisions from "../data/high-school-catalog-identity-decisions.json" with { type: "json" };
import {
  REVIEWED_HIGH_SCHOOL_KEEP_IDS,
  REVIEWED_HIGH_SCHOOL_EXCLUDE_IDS,
  highSchoolCatalogIdentityDecision,
  isSchoolCatalogVisible,
  reviewedHighSchoolIdentitySummary
} from "../src/high-school-catalog-identity.js";

const EXPECTED_KEEP = new Set([
  "df-ktr7yd",
  "df-a6slv2",
  "df-vs7zsu",
  "df-srqlt7",
  "df-5xyspt"
]);

const EXPECTED_EXCLUDE = new Set([
  "df-2tng4g",
  "df-cc7dyc",
  "df-abs2rr",
  "df-qscp6x",
  "df-urlzfa",
  "df-25lkrp"
]);

test("all 11 production-only high-school identities now have explicit decisions", () => {
  const extras = reconciliation.production_high_school_rows_not_in_certified_aaa_295;
  assert.equal(extras.length, 11);
  const reviewed = new Set([...REVIEWED_HIGH_SCHOOL_KEEP_IDS, ...REVIEWED_HIGH_SCHOOL_EXCLUDE_IDS]);
  assert.equal(reviewed.size, 11);
  assert.deepEqual(new Set(extras.map(row => row.school_id)), reviewed);
  for (const row of extras) {
    const result = highSchoolCatalogIdentityDecision({ id: row.school_id, name: row.school_name, level: "high-school" });
    assert.ok(result.decision === "keep" || result.decision === "exclude", `${row.school_id} must be reviewed`);
    assert.equal(result.reviewed, true);
  }
});

test("reviewed production identities split 5 keep and 6 exclude", () => {
  assert.deepEqual(new Set(REVIEWED_HIGH_SCHOOL_KEEP_IDS), EXPECTED_KEEP);
  assert.deepEqual(new Set(REVIEWED_HIGH_SCHOOL_EXCLUDE_IDS), EXPECTED_EXCLUDE);
  assert.equal(decisions.keep.length, 5);
  assert.equal(decisions.exclude.length, 6);
  const summary = reviewedHighSchoolIdentitySummary();
  assert.equal(summary.baseCertifiedHighSchools, 295);
  assert.equal(summary.reviewedKeepAdditions, 5);
  assert.equal(summary.reviewedExclusions, 6);
  assert.equal(summary.userFacingHighSchoolDenominator, 300);
});

test("reviewed keeps remain visible", () => {
  for (const row of decisions.keep) {
    assert.equal(isSchoolCatalogVisible({ id: row.school_id, name: row.name, level: "high-school" }), true, row.name);
  }
});

test("reviewed lower-grade rows are hidden", () => {
  for (const row of decisions.exclude) {
    assert.equal(isSchoolCatalogVisible({ id: row.school_id, name: row.name, level: "high-school" }), false, row.name);
  }
});

test("elementary and junior-high names fail closed outside explicit review", () => {
  assert.equal(isSchoolCatalogVisible({ id: "x", name: "Example Elementary School", level: "high-school" }), false);
  assert.equal(isSchoolCatalogVisible({ id: "y", name: "Example Junior High School", level: "high-school" }), false);
  assert.equal(isSchoolCatalogVisible({ id: "z", name: "Example High School", level: "high-school" }), true);
  assert.equal(isSchoolCatalogVisible({ id: "college", name: "Junior High College", level: "college" }), true);
});
