import test from "node:test";
import assert from "node:assert/strict";
import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "../src/college-team-inventory.js";
import {
  COLLEGE_SOURCE_PLATFORMS,
  collegeSourceAuditSummary,
  parserReadyCollegeSourceCandidates
} from "../src/college-source-platforms.js";

const inventoryIds = ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => row.schoolId).sort();

test("M3 provider audit classifies every college exactly once", () => {
  const ids = COLLEGE_SOURCE_PLATFORMS.map(row => row.schoolId).sort();
  assert.deepEqual(ids, inventoryIds);
  assert.equal(new Set(ids).size, 36);
});

test("M3 provider audit identifies the existing Sidearm parser as reusable for 79 targets", () => {
  assert.deepEqual(collegeSourceAuditSummary(), {
    schools: 36,
    parserReadySchools: 17,
    parserReadyTeams: 79,
    needsParserSchools: 4,
    needsParserTeams: 15,
    pendingTeams: 38,
    totalTeams: 132
  });
});

test("M3 Sidearm source candidates map every parser-ready target to one official https schedule URL", () => {
  const candidates = parserReadyCollegeSourceCandidates("2026");
  assert.equal(candidates.length, 79);
  assert.equal(new Set(candidates.map(row => `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`)).size, 79);

  for (const source of candidates) {
    assert.equal(source.parserType, "sidearm");
    assert.equal(source.sourceType, "official-athletics");
    assert.equal(source.certificationState, "platform-ready-source-pending-live-proof");
    assert.match(source.sourceUrl, /^https:\/\//);
    assert.match(source.sourceUrl, /\/sports\/.+\/schedule\/2026(?:-27)?$/);
    if (source.sport === "basketball") assert.match(source.sourceUrl, /\/2026-27$/);
    else assert.match(source.sourceUrl, /\/2026$/);
  }
});

test("M3 source audit remains read-only metadata and contains no production D1 mutation", () => {
  // The source-platform checkpoint deliberately returns candidates only. Source
  // insertion/enabling is a later bounded step after each exact URL has live proof.
  const candidates = parserReadyCollegeSourceCandidates("2026");
  assert.ok(candidates.every(row => row.certificationState.includes("pending-live-proof")));
});
