import test from "node:test";
import assert from "node:assert/strict";
import { resilientAlias, resolveResilientSchool, recentGameDate } from "../src/hootens-resilient-results.js";

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
