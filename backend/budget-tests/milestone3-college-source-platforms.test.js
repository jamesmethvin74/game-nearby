import test from "node:test";
import assert from "node:assert/strict";
import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "../src/college-team-inventory.js";
import {
  COLLEGE_SOURCE_PLATFORMS,
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

test("M3 provider audit separates existing-parser, feed-ready, custom-parser and pending targets", () => {
  assert.deepEqual(collegeSourceAuditSummary(), {
    schools: 36,
    parserReadySchools: 17,
    parserReadyTeams: 79,
    feedReadyParserNeededSchools: 3,
    feedReadyParserNeededTeams: 10,
    needsParserSchools: 1,
    needsParserTeams: 5,
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

test("M3 PrestoSports targets use provider-supported season RSS feeds", () => {
  const candidates = prestoCollegeSourceCandidates("2026");
  assert.equal(candidates.length, 10);
  assert.equal(new Set(candidates.map(row => `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`)).size, 10);
  assert.deepEqual([...new Set(candidates.map(row => row.schoolId))].sort(), ["asu-newport","champion-christian","ua-cossatot"].sort());

  for (const source of candidates) {
    assert.equal(source.parserType, "prestosports-rss");
    assert.equal(source.sourceType, "official-athletics");
    assert.equal(source.certificationState, "feed-identified-parser-pending-live-proof");
    assert.match(source.sourceUrl, /^https:\/\//);
    assert.match(source.sourceUrl, /\/sports\/(?:mbkb|wbkb|msoc|wsoc|wvball)\/2026-27\/schedule\?print=rss$/);
  }
});

test("M3 source audit remains read-only metadata and contains no production D1 mutation", () => {
  const candidates = [...parserReadyCollegeSourceCandidates("2026"), ...prestoCollegeSourceCandidates("2026")];
  assert.equal(candidates.length, 89);
  assert.ok(candidates.every(row => row.certificationState.includes("pending-live-proof")));
});
