import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const normalizer = await readFile(new URL("../src/schedule-response-normalizer.js", import.meta.url), "utf8");
const index = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

test("record engine preserves conference W-L-T fields for later standings", () => {
  assert.match(normalizer, /conference_wins/);
  assert.match(normalizer, /conference_losses/);
  assert.match(normalizer, /conference_ties/);
  assert.match(index, /conferences\/\(\[\^\/\]\+\)\/standings/);
});
