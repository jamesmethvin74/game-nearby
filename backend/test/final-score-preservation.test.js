import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("statewide ingestion retains final scores needed for results and records", () => {
  assert.match(statewide, /teamScore/);
  assert.match(statewide, /opponentScore/);
  assert.match(statewide, /home_score/);
  assert.match(statewide, /away_score/);
  assert.match(statewide, /status:\s*status/);
});
