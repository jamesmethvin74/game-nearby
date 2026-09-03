import test from "node:test";
import assert from "node:assert/strict";
import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "../src/college-team-inventory.js";
import {
  COLLEGE_SOURCE_PLATFORMS,
  blockedPrestoAuthoritySummary,
  blockedPrestoAuthorityTargets,
  collegeSourceAuditSummary,
  parserReadyCollegeSourceCandidates
} from "../src/college-source-platforms.js";

const inventoryIds = ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => row.schoolId).sort();

test("M3 provider audit classifies every college exactly once", () => {
  const ids = COLLEGE_SOURCE_PLATFORMS.map(row => row.schoolId).sort();
  assert.deepEqual(ids, inventoryIds);
  assert.equal(new Set(ids).size, 36);
});

test("M3 provider audit distinguishes server-fetchable sources from blocked authorities", () => {
  assert.deepEqual(collegeSourceAuditSummary(), {
    schools:36,
    parserReadySchools:18,
    parserReadyTeams:84,
    blockedAuthoritySchools:16,
    blockedAuthorityTeams:48,
    noSupportedTeamSchools:2,
    pendingTeams:0,
    totalTeams:132
  });
  assert.deepEqual(blockedPrestoAuthoritySummary(), {
    schools:16,
    teams:48,
    naiaTeams:16,
    njcaaTeams:27,
    directPrestoTeams:5
  });
});

test("M3 parser-ready candidates cover 75 classic Sidearm, 4 modern Sidearm and 5 Razorback targets", () => {
  const candidates = parserReadyCollegeSourceCandidates("2026");
  assert.equal(candidates.length,84);
  assert.equal(new Set(candidates.map(row => `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`)).size,84);

  const razorbacks = candidates.filter(row => row.parserType === "arkansas-razorbacks");
  const classic = candidates.filter(row => row.parserType === "sidearm");
  const modern = candidates.filter(row => row.parserType === "sidearm-modern");
  assert.equal(razorbacks.length,5);
  assert.equal(classic.length,75);
  assert.equal(modern.length,4);
  assert.ok(modern.every(row=>row.schoolId==="little-rock"));

  for (const source of candidates) {
    assert.equal(source.sourceType,"official-athletics");
    assert.equal(source.certificationState,"parser-ready-source-pending-live-proof");
    assert.match(source.sourceUrl,/^https:\/\//);
    if (source.parserType === "sidearm") {
      assert.match(source.sourceUrl,/\/sports\/.+\/schedule\/2026(?:-27)?$/);
    } else if (source.parserType === "sidearm-modern") {
      if(source.sport==="basketball") assert.match(source.sourceUrl,/^https:\/\/lrtrojans\.com\/sports\/(?:mens|womens)-basketball\/schedule\/$/);
      else assert.match(source.sourceUrl,/^https:\/\/lrtrojans\.com\/sports\/womens-(?:soccer|volleyball)\/schedule\/season\/2026$/);
    } else {
      assert.match(source.sourceUrl,/^https:\/\/arkansasrazorbacks\.com\/sport\/(?:m-footbl|m-baskbl|w-baskbl|w-soccer|w-volley)\/schedule\/$/);
    }
  }
});

test("M3 never exposes challenged PrestoSports authorities as production source candidates", () => {
  const blocked = blockedPrestoAuthorityTargets();
  assert.equal(blocked.length,48);
  assert.ok(blocked.every(row => row.serverFetchable === false));
  assert.ok(blocked.every(row => row.certificationState === "authority-confirmed-fallback-pending"));
  assert.equal(new Set(blocked.map(row => row.schoolId)).size,16);

  const readyKeys = new Set(parserReadyCollegeSourceCandidates("2026").map(row => `${row.schoolId}|${row.sport}|${row.gender}`));
  for (const row of blocked) assert.ok(!readyKeys.has(`${row.schoolId}|${row.sport}|${row.gender}`));
});
