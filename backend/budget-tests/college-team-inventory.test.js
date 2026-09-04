import test from "node:test";
import assert from "node:assert/strict";
import { ARKANSAS_COLLEGE_TEAM_INVENTORY, collegeInventorySummary } from "../src/college-team-inventory.js";

const EXPECTED_SCHOOLS = [
  "uark","arkansas-state","uapb","uca","little-rock","arkansas-tech","uafs","uam","harding","henderson-state","ouachita-baptist","southern-arkansas","hendrix","lyon","ozarks","arkansas-baptist","cbc","crowleys-ridge","john-brown","philander-smith","williams-baptist","asu-mid-south","asu-mountain-home","asu-newport","asu-three-rivers","national-park","north-arkansas","nwacc","shorter","south-arkansas","seark","sau-tech","ua-rich-mountain","ua-cossatot","champion-christian","ecclesia"
].sort();

const SUPPORTED_SPORTS = new Set(["football","basketball","soccer","volleyball"]);
const SUPPORTED_GENDERS = new Set(["men","women"]);

test("college milestone inventory covers all 36 catalog colleges", () => {
  const actual = ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => row.schoolId).sort();
  assert.deepEqual(actual, EXPECTED_SCHOOLS);
  assert.equal(new Set(actual).size, 36);
});

test("college milestone inventory establishes 130 current supported-team targets", () => {
  const summary = collegeInventorySummary();
  assert.equal(summary.schools, 36);
  assert.equal(summary.expectedTeams, 130);
  assert.equal(summary.verifiedSchools, 35);
  assert.equal(summary.verifiedTeams, 125);
  assert.equal(summary.provisionalSchools, 1);
});

test("college target teams use supported sports and unique school/sport/gender keys", () => {
  const seen = new Set();
  for (const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    assert.ok(/^https:\/\//.test(school.sourceUrl), `${school.schoolId} needs an https source`);
    assert.ok(["verified","provisional"].includes(school.verificationStatus));
    for (const team of school.teams) {
      assert.ok(SUPPORTED_SPORTS.has(team.sport), `${school.schoolId}: unsupported ${team.sport}`);
      assert.ok(SUPPORTED_GENDERS.has(team.gender), `${school.schoolId}: unsupported gender ${team.gender}`);
      const key = `${school.schoolId}:${team.sport}:${team.gender}`;
      assert.ok(!seen.has(key), `duplicate target team ${key}`);
      seen.add(key);
    }
  }
  assert.equal(seen.size, 130);
});

test("colleges without a current LocalBleachers-supported sport are represented explicitly", () => {
  const byId = new Map(ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => [row.schoolId, row]));
  assert.equal(byId.get("asu-mountain-home").teams.length, 0);
  assert.equal(byId.get("asu-newport").teams.length, 0);
  assert.equal(byId.get("asu-three-rivers").teams.length, 0);
  assert.match(byId.get("asu-newport").verificationNote, /discontinued men's basketball effective July 1, 2026/i);
  assert.equal(byId.get("north-arkansas").teams.some(team => team.sport === "soccer"), false);
});
