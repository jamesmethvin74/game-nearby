import test from "node:test";
import assert from "node:assert/strict";
import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "../src/college-team-inventory.js";
import {
  COLLEGE_SOURCE_PLATFORMS,
  bulkCollegeTargetSummary,
  collegeSourceAuditSummary,
  parserReadyCollegeSourceCandidates,
  prestoCollegeSourceCandidates
} from "../src/college-source-platforms.js";

const inventoryIds = ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => row.schoolId).sort();

test("M3 provider audit classifies every college exactly once", () => {
  const ids = COLLEGE_SOURCE_PLATFORMS.map(row => row.schoolId).sort();
  assert.deepEqual(ids, inventoryIds);
  assert.equal(new Set(ids).size, 36);
});

test("M3 provider audit leaves zero team targets platform-unclassified", () => {
  assert.deepEqual(collegeSourceAuditSummary(), {
    schools: 36,
    parserReadySchools: 17,
    parserReadyTeams: 79,
    feedReadyParserNeededSchools: 1,
    feedReadyParserNeededTeams: 5,
    bulkFeedCandidateSchools: 15,
    bulkFeedCandidateTeams: 43,
    needsParserSchools: 1,
    needsParserTeams: 5,
    noSupportedTeamSchools: 2,
    pendingTeams: 0,
    totalTeams: 132
  });
  assert.deepEqual(bulkCollegeTargetSummary(), {
    schools: 15,
    teams: 43,
    naiaSchools: 4,
    njcaaSchools: 11
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

test("M3 direct PrestoSports candidate is Champion Christian only after NJCAA consolidation", () => {
  const candidates = prestoCollegeSourceCandidates("2026");
  assert.equal(candidates.length, 5);
  assert.equal(new Set(candidates.map(row => `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`)).size, 5);
  assert.deepEqual([...new Set(candidates.map(row => row.schoolId))], ["champion-christian"]);

  for (const source of candidates) {
    assert.equal(source.parserType, "prestosports-rss");
    assert.equal(source.sourceType, "official-athletics");
    assert.equal(source.certificationState, "feed-identified-parser-pending-live-proof");
    assert.match(source.sourceUrl, /^https:\/\//);
    assert.match(source.sourceUrl, /\/sports\/(?:mbkb|wbkb|msoc|wsoc|wvball)\/2026-27\/schedule\?print=rss$/);
  }
});

test("M3 direct-source candidates remain read-only metadata pending live proof", () => {
  const candidates = [...parserReadyCollegeSourceCandidates("2026"), ...prestoCollegeSourceCandidates("2026")];
  assert.equal(candidates.length, 84);
  assert.ok(candidates.every(row => row.certificationState.includes("pending-live-proof")));
});
