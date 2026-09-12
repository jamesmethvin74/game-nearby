import test from "node:test";
import assert from "node:assert/strict";
import { planM7FinalTwoRepair } from "../src/m7-final-two-repair.js";
import {
  M7_FINAL_VERSION_PATH,
  M7_FINAL_PLAN_PATH,
  M7_FINAL_EXECUTE_PATH,
  M7_FINAL_MARKER,
  M7_FINAL_EXPIRES_AT
} from "../src/logo-bootstrap-worker.js";

test("M7 final corrections are version gated, bounded, and temporary", () => {
  assert.equal(typeof planM7FinalTwoRepair, "function");
  assert.equal(M7_FINAL_VERSION_PATH, "/api/v1/internal/m7-final-three-version-9c27e4ad");
  assert.equal(M7_FINAL_PLAN_PATH, "/api/v1/internal/m7-final-three-plan-9c27e4ad");
  assert.equal(M7_FINAL_EXECUTE_PATH, "/api/v1/internal/m7-final-three-execute-9c27e4ad");
  assert.equal(M7_FINAL_MARKER, "m7-final-three-corrections-v2-bed011f5");
  assert.equal(M7_FINAL_EXPIRES_AT, Date.parse("2026-09-12T06:30:00Z"));
});
