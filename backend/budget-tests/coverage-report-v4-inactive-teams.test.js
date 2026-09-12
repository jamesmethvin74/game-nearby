import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUDIT_CONTRACT_V4,
  collegeSourceResolution,
  hardenTeam
} from "../src/coverage-report-worker-v3.js";
import {
  blockedPrestoAuthorityTargets,
  pendingPrestoFallbackTargets
} from "../src/college-source-resolution.js";

function baseTeam(overrides = {}) {
  return {
    team_id:"cbc-basketball-women-2026",
    school_id:"cbc",
    school_name:"Central Baptist College",
    level:"college",
    sport:"basketball",
    gender:"women",
    season:"2026",
    expected_target:true,
    backend_team_present:true,
    schedule_status:"Missing",
    schedule_basis:"enabled_source_missing",
    results_status:"Missing",
    records_status:"Missing",
    standings_status:"Unverified",
    issues:[
      { code:"schedule_source_missing", category:"schedule" },
      { code:"record_missing", category:"record" }
    ],
    ...overrides
  };
}

function baseRow(overrides = {}) {
  return {
    school_id:"cbc",
    level:"college",
    sport:"basketball",
    gender:"women",
    season:"2026",
    team_active:0,
    source_count:0,
    enabled_source_count:0,
    standings_method:"unavailable",
    ...overrides
  };
}

test("v4 contract explicitly distinguishes inactive from missing", () => {
  assert.equal(AUDIT_CONTRACT_V4.version, "truthful-coverage-v4");
  assert.equal(AUDIT_CONTRACT_V4.rule, "Present is not Complete.");
  assert.match(AUDIT_CONTRACT_V4.inactive_team_rule, /inactive/i);
});

test("known pending college target is present-but-inactive, never missing", () => {
  const team = hardenTeam(baseTeam(), baseRow());
  assert.equal(team.backend_team_present, true);
  assert.equal(team.backend_team_active, false);
  assert.equal(team.source_resolution, "pending");
  assert.ok(team.issues.some(issue => issue.code === "expected_team_inactive"));
  assert.ok(team.issues.some(issue => issue.code === "college_source_pending"));
  assert.ok(!team.issues.some(issue => issue.code === "missing_expected_team"));
});

test("known blocked college target is classified separately from pending", () => {
  const row = baseRow({ school_id:"philander-smith", gender:"men" });
  assert.equal(collegeSourceResolution(row), "blocked");
  const team = hardenTeam(baseTeam({ school_id:"philander-smith", gender:"men" }), row);
  assert.equal(team.source_resolution, "blocked");
  assert.ok(team.issues.some(issue => issue.code === "college_source_blocked"));
});

test("source-resolution inventory accounts for all 27 intentionally inactive college targets", () => {
  assert.equal(pendingPrestoFallbackTargets("2026").length, 8);
  assert.equal(blockedPrestoAuthorityTargets("2026").length, 19);
  assert.equal(pendingPrestoFallbackTargets("2026").length + blockedPrestoAuthorityTargets("2026").length, 27);
});

test("coverage SQL retains inactive college rows while avoiding inactive high-school noise", async () => {
  const source = await readFile(new URL("../src/coverage-report-worker-v3.js", import.meta.url), "utf8");
  assert.match(source, /t\.active AS team_active/);
  assert.match(source, /AND \(t\.active=1 OR sch\.level='college'\)/);
  assert.match(source, /tt\.team_active/);
  assert.doesNotMatch(source, /WHERE t\.active=1 AND t\.season=/);
  assert.match(source, /expected_targets_inactive/);
  assert.match(source, /college_source_pending/);
  assert.match(source, /college_source_blocked/);
});
