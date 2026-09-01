import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rebuild = await readFile(new URL("../src/record-rebuild.js", import.meta.url), "utf8");

test("record rebuild includes unmatched school-feed finals as well as canonical results", () => {
  assert.match(rebuild, /g\.canonical_event_id IS NULL/);
  assert.match(rebuild, /g\.status='FINAL'/);
  assert.match(rebuild, /canonicalCandidate/);
  assert.match(rebuild, /rawCandidate/);
  assert.match(rebuild, /recordFromScheduleRows/);
});
