import test from "node:test";
import assert from "node:assert/strict";
import { resilientAlias, resolveResilientSchool, recentGameDate, missingLocalFinalSides } from "../src/hootens-resilient-results.js";
import { sameRecoveredHootenFinal } from "../src/hootens-complete-results.js";

test("resilientAlias normalizes Hooten school labels", () => {
  assert.equal(resilientAlias("Har-Ber (Springdale)"), "har ber");
  assert.equal(resilientAlias("Fort Smith Northside"), "northside");
  assert.equal(resilientAlias("FS Southside"), "southside");
  assert.equal(resilientAlias("Southside (Batesville)"), "batesville southside");
  assert.equal(resilientAlias("Helena–West Helena"), "central west helena");
});

test("resolveResilientSchool disambiguates Fort Smith and Batesville Southside", () => {
  const northside = { school_id: "northside-fs" };
  const southsideFs = { school_id: "southside-fs" };
  const southsideBatesville = { school_id: "southside-batesville" };
  const indexes = {
    byNameCity: new Map([
      ["northside|fort smith", northside],
      ["southside|fort smith", southsideFs],
      ["southside|batesville", southsideBatesville]
    ]),
    byAlias: new Map([
      ["northside", northside],
      ["batesville southside", southsideBatesville]
    ])
  };
  assert.equal(resolveResilientSchool("Fort Smith Northside", indexes)?.school_id, "northside-fs");
  assert.equal(resolveResilientSchool("Fort Smith Southside", indexes)?.school_id, "southside-fs");
  assert.equal(resolveResilientSchool("Southside (Batesville)", indexes)?.school_id, "southside-batesville");
});

test("recentGameDate derives the correct Week 1 Thursday and Friday dates", () => {
  const now = new Date("2026-09-05T18:00:00.000Z");
  assert.equal(recentGameDate("thursday", now), "2026-09-03T12:00:00.000Z");
  assert.equal(recentGameDate("friday", now), "2026-09-04T12:00:00.000Z");
});

test("missingLocalFinalSides keeps a missing reciprocal team side even when the other side exists", () => {
  const blevins = { school_id: "blevins" };
  const guyPerkins = { school_id: "guy-perkins" };
  const sides = [
    { school: blevins, opponentSchool: guyPerkins, opponentName: "Guy-Perkins", teamScore: 12, opponentScore: 28 },
    { school: guyPerkins, opponentSchool: blevins, opponentName: "Blevins", teamScore: 28, opponentScore: 12 }
  ];
  const gamesBySchool = new Map([
    ["blevins", [{ status: "FINAL", opponent_school_id: "guy-perkins", opponent: "Guy-Perkins", team_score: 12, opponent_score: 28 }]],
    ["guy-perkins", []]
  ]);

  const missing = missingLocalFinalSides(sides, gamesBySchool);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].school.school_id, "guy-perkins");
});


test("recovered Hooten team-page date reuses an adjacent resilient fallback for the same exact final", () => {
  const caveCity={
    status:"FINAL",opponent_school_id:"cedar-ridge",opponent:"Cedar Ridge High School",
    scheduled_at:"2026-09-03T12:00:00.000Z",team_score:28,opponent_score:34
  };
  assert.equal(sameRecoveredHootenFinal(caveCity,{
    opponentSchoolId:"cedar-ridge",opponentName:"Cedar Ridge",teamScore:28,opponentScore:34,
    scheduledAt:"2026-09-04T12:00:00.000Z"
  }),true);
  const corning={
    status:"FINAL",opponent_school_id:"lafayette-county",opponent:"Lafayette County School",
    scheduled_at:"2026-09-03T12:00:00.000Z",team_score:44,opponent_score:8
  };
  assert.equal(sameRecoveredHootenFinal(corning,{
    opponentSchoolId:"lafayette-county",opponentName:"Lafayette County",teamScore:44,opponentScore:8,
    scheduledAt:"2026-09-04T12:00:00.000Z"
  }),true);
  assert.equal(sameRecoveredHootenFinal(corning,{
    opponentSchoolId:"lafayette-county",opponentName:"Lafayette County",teamScore:43,opponentScore:8,
    scheduledAt:"2026-09-04T12:00:00.000Z"
  }),false);
  assert.equal(sameRecoveredHootenFinal(corning,{
    opponentSchoolId:"lafayette-county",opponentName:"Lafayette County",teamScore:44,opponentScore:8,
    scheduledAt:"2026-09-05T12:00:01.000Z"
  }),false);
});

// SECURITY_DEPLOYMENT_TEST_MARKER_20260930
