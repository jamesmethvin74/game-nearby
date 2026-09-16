import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");

test("record UI never falls back to a fabricated preseason or client-calculated record", () => {
  assert.doesNotMatch(polish, /standing:\"Preseason\"/);
  assert.match(polish, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(polish, /unified\.record_verified===true/);
  assert.match(polish, /overall:recordVerified && unified\.overall_record \? unified\.overall_record : "—"/);
  assert.doesNotMatch(polish, /event\.record/);
  assert.doesNotMatch(polish, /recordLabel\(/);
});