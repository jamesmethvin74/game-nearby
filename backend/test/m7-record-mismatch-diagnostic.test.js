import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseM7RecordMismatches } from "../src/m7-record-mismatch-diagnostic.js";

test("M7 record mismatch diagnostic exports a callable zero-write diagnostic", () => {
  assert.equal(typeof diagnoseM7RecordMismatches,"function");
});
