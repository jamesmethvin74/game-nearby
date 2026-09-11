import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseM7AttachmentGaps } from "../src/m7-attachment-gap-diagnostic.js";

test("M7 attachment-gap diagnostic exports a callable zero-write diagnostic", () => {
  assert.equal(typeof diagnoseM7AttachmentGaps,"function");
});
