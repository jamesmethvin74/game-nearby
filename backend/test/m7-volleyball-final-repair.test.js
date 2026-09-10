import test from "node:test";
import assert from "node:assert/strict";
import {
  M7_AUG17_APPROVED_FINGERPRINT,
  M7_AUG17_EXPECTED_ROWS_WRITTEN
} from "../src/m7-volleyball-final-repair.js";

test("approved M7 Aug 17 repair is locked to the reviewed fingerprint and 14-row budget",()=>{
  assert.equal(M7_AUG17_APPROVED_FINGERPRINT,"m7-aug17-ae53a9b4");
  assert.equal(M7_AUG17_EXPECTED_ROWS_WRITTEN,14);
});
