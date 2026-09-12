import test from "node:test";
import assert from "node:assert/strict";
import { planM7FinalTwoRepair, M7_FINAL_TWO_REPAIR_FINGERPRINT } from "../src/m7-final-two-repair.js";
import {
  M7_FINAL_VERSION_PATH,
  M7_FINAL_EVIDENCE_PATH,
  M7_FINAL_PLAN_PATH,
  M7_FINAL_EXECUTE_PATH,
  M7_FINAL_MARKER,
  M7_FINAL_EXPIRES_AT
} from "../src/logo-bootstrap-worker.js";

test("M7 final corrections v3 are exact, version gated, bounded, and temporary", () => {
  assert.equal(typeof planM7FinalTwoRepair, "function");
  assert.equal(M7_FINAL_TWO_REPAIR_FINGERPRINT, "m7-final-three-corrections-v3");
  assert.equal(M7_FINAL_VERSION_PATH, "/api/v1/internal/m7-final-three-version-e4b7c631");
  assert.equal(M7_FINAL_EVIDENCE_PATH, "/api/v1/internal/m7-final-four-team-evidence-e4b7c631");
  assert.equal(M7_FINAL_PLAN_PATH, "/api/v1/internal/m7-final-three-plan-e4b7c631");
  assert.equal(M7_FINAL_EXECUTE_PATH, "/api/v1/internal/m7-final-three-execute-e4b7c631");
  assert.equal(M7_FINAL_MARKER, "m7-final-three-corrections-v3-a61d8f2c");
  assert.equal(M7_FINAL_EXPIRES_AT, Date.parse("2026-09-12T06:30:00Z"));
});
