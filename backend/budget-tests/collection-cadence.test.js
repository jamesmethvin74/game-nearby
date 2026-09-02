import test from "node:test";
import assert from "node:assert/strict";
import { collectionPlanAt } from "../src/collection-cadence.js";

function kind(iso) {
  return collectionPlanAt(new Date(iso))?.kind || null;
}

test("daily collection windows are limited to 6 AM, 3 PM, and 11 PM Central", () => {
  assert.equal(kind("2026-09-02T11:00:00Z"), "morning-results");
  assert.equal(kind("2026-09-02T20:00:00Z"), "afternoon-schedule-check");
  assert.equal(kind("2026-09-03T04:00:00Z"), "evening-results");
  assert.equal(kind("2026-09-02T11:30:00Z"), null);
});

test("Friday football runs every 30 minutes from 8:30 PM through midnight Central", () => {
  const slots = [
    "2026-09-05T01:30:00Z",
    "2026-09-05T02:00:00Z",
    "2026-09-05T02:30:00Z",
    "2026-09-05T03:00:00Z",
    "2026-09-05T03:30:00Z",
    "2026-09-05T04:00:00Z",
    "2026-09-05T04:30:00Z",
    "2026-09-05T05:00:00Z"
  ];
  for (const slot of slots) assert.equal(kind(slot), "friday-football-results", slot);
  assert.equal(kind("2026-09-05T01:00:00Z"), null);
  assert.equal(kind("2026-09-05T05:30:00Z"), null);
});

test("weekly catalog maintenance is isolated to Sunday 4 AM Central", () => {
  const plan = collectionPlanAt(new Date("2026-09-06T09:00:00Z"));
  assert.equal(plan?.kind, "weekly-catalog-maintenance");
  assert.equal(plan?.runCatalogMaintenance, true);
  assert.equal(plan?.runCore, false);
});

test("cadence remains correct after Central time returns to standard time", () => {
  assert.equal(kind("2027-01-08T12:00:00Z"), "morning-results");
  assert.equal(kind("2027-01-09T02:30:00Z"), "friday-football-results");
});

test("Friday-night plan does not trigger statewide catalog work", () => {
  const plan = collectionPlanAt(new Date("2026-09-05T03:00:00Z"));
  assert.equal(plan?.kind, "friday-football-results");
  assert.equal(plan?.runCatalogMaintenance, false);
  assert.equal(plan?.runStatewide, false);
  assert.equal(plan?.runCore, true);
});
