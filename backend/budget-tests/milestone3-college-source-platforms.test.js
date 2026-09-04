import test from "node:test";
import assert from "node:assert/strict";
import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "../src/college-team-inventory.js";
import {
  COLLEGE_SOURCE_PLATFORMS,
  blockedPrestoAuthoritySummary,
  blockedPrestoAuthorityTargets,
  collegeSourceAuditSummary,
  parserReadyCollegeSourceCandidates,
  pendingPrestoFallbackSummary,
  pendingPrestoFallbackTargets
} from "../src/college-source-resolution.js";

const inventoryIds = ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => row.schoolId).sort();
const key = row => `${row.schoolId}|${row.sport}|${row.gender}`;

test("M3 provider audit classifies every college exactly once", () => {
  const ids = COLLEGE_SOURCE_PLATFORMS.map(row => row.schoolId).sort();
  assert.deepEqual(ids, inventoryIds);
  assert.equal(new Set(ids).size, 36);
});

test("M3 source resolution separates ready, unpublished, and blocked targets", () => {
  assert.deepEqual(collegeSourceAuditSummary("2026"), {
    schools:36,
    parserReadySchools:24,
    parserReadyTeams:98,
    blockedAuthoritySchools:9,
    blockedAuthorityTeams:25,
    noSupportedTeamSchools:3,
    pendingSchools:4,
    pendingTeams:7,
    totalTeams:130
  });
  assert.deepEqual(blockedPrestoAuthoritySummary("2026"), {
    schools:9,
    teams:25,
    naiaTeams:3,
    njcaaTeams:17,
    directPrestoTeams:5
  });
  assert.deepEqual(pendingPrestoFallbackSummary("2026"), {schools:4,teams:7});
});

test("M3 parser-ready candidates include exactly twelve live-proved Presto RSS fallbacks", () => {
  const candidates = parserReadyCollegeSourceCandidates("2026");
  assert.equal(candidates.length,98);
  assert.equal(new Set(candidates.map(row => `${key(row)}|${row.season}`)).size,98);

  const razorbacks = candidates.filter(row => row.parserType === "arkansas-razorbacks");
  const classic = candidates.filter(row => row.parserType === "sidearm");
  const modern = candidates.filter(row => row.parserType === "sidearm-modern");
  const institutional = candidates.filter(row => row.parserType === "institutional-table");
  const presto = candidates.filter(row => row.parserType === "prestosports-rss");
  assert.equal(razorbacks.length,5);
  assert.equal(classic.length,75);
  assert.equal(modern.length,4);
  assert.equal(institutional.length,2);
  assert.equal(presto.length,12);

  assert.deepEqual(new Set(presto.map(key)), new Set([
    "cbc|soccer|men",
    "cbc|soccer|women",
    "cbc|volleyball|women",
    "crowleys-ridge|basketball|men",
    "crowleys-ridge|volleyball|women",
    "williams-baptist|soccer|men",
    "williams-baptist|soccer|women",
    "williams-baptist|volleyball|women",
    "national-park|soccer|men",
    "national-park|soccer|women",
    "nwacc|soccer|men",
    "nwacc|soccer|women"
  ]));
  assert.ok(presto.every(row=>row.certificationState==="parser-ready-live-proved"));
  assert.ok(presto.every(row=>/\/composite\?print=rss$/.test(row.sourceUrl)));

  for (const source of candidates) {
    assert.equal(source.sourceType,"official-athletics");
    assert.match(source.sourceUrl,/^https:\/\//);
    if (source.parserType === "sidearm") {
      assert.match(source.sourceUrl,/\/sports\/.+\/schedule\/2026(?:-27)?$/);
    } else if (source.parserType === "sidearm-modern") {
      if(source.sport==="basketball") assert.match(source.sourceUrl,/^https:\/\/lrtrojans\.com\/sports\/(?:mens|womens)-basketball\/schedule\/$/);
      else assert.match(source.sourceUrl,/^https:\/\/lrtrojans\.com\/sports\/womens-(?:soccer|volleyball)\/schedule\/season\/2026$/);
    } else if (source.parserType === "institutional-table") {
      assert.match(source.sourceUrl,/^https:\/\/www\.northark\.edu\/athletics\/(?:mens|womens)-basketball\/$/);
    }
  }
});

test("M3 leaves seven reachable but unpublished 2026-27 Presto fallbacks pending", () => {
  const pending=pendingPrestoFallbackTargets("2026");
  assert.equal(pending.length,7);
  assert.deepEqual(new Set(pending.map(key)),new Set([
    "cbc|basketball|men",
    "cbc|basketball|women",
    "crowleys-ridge|basketball|women",
    "williams-baptist|basketball|men",
    "williams-baptist|basketball|women",
    "national-park|basketball|men",
    "national-park|basketball|women"
  ]));
  assert.ok(pending.every(row=>row.serverFetchable===true));
  assert.ok(pending.every(row=>row.certificationState==="fallback-reachable-schedule-unpublished"));
});

test("M3 never exposes genuinely blocked Presto authorities as source candidates", () => {
  const blocked = blockedPrestoAuthorityTargets("2026");
  assert.equal(blocked.length,25);
  assert.ok(blocked.every(row => row.serverFetchable === false));
  assert.equal(new Set(blocked.map(row => row.schoolId)).size,9);

  const readyKeys = new Set(parserReadyCollegeSourceCandidates("2026").map(key));
  const pendingKeys = new Set(pendingPrestoFallbackTargets("2026").map(key));
  for (const row of blocked) {
    assert.ok(!readyKeys.has(key(row)));
    assert.ok(!pendingKeys.has(key(row)));
  }
});
