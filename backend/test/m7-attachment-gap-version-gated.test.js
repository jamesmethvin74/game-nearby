import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseM7AttachmentGaps } from "../src/m7-attachment-gap-diagnostic.js";
import {
  M7_ATTACHMENT_VERSION_PATH,
  M7_ATTACHMENT_DIAGNOSTIC_PATH,
  M7_ATTACHMENT_DEPLOYMENT_MARKER
} from "../src/logo-bootstrap-worker.js";

test("M7 attachment diagnostic is version gated and callable", () => {
  assert.equal(typeof diagnoseM7AttachmentGaps, "function");
  assert.match(M7_ATTACHMENT_VERSION_PATH, /m7-attachment-gap-version/);
  assert.match(M7_ATTACHMENT_DIAGNOSTIC_PATH, /m7-attachment-gap-diagnostic/);
  assert.equal(M7_ATTACHMENT_DEPLOYMENT_MARKER, "m7-attachment-gap-v3-33f72b3c");
});
