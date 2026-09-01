import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");

test("record UI never falls back to a fabricated preseason 0-0", () => {
  assert.doesNotMatch(polish, /standing:\"Preseason\"/);
  assert.match(polish, /if \(!record\) return \{overall:\"—\",conference:\"—\"/);
});
