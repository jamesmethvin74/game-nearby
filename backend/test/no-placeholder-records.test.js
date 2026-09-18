import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");

test("record UI prefers factual backend presentation and never fabricates preseason status", () => {
  assert.doesNotMatch(polish, /standing:\"Preseason\"/);
  assert.match(polish, /LocalBleachersLive\?\.getTeamStatus/);
  assert.match(polish, /LocalBleachersPresentation\?\.teamStatus/);
  const factual = polish.indexOf("if (factual) return factual");
  const embeddedFallback = polish.indexOf("const record = event.record || null");
  assert.ok(factual >= 0 && embeddedFallback > factual, "current team-status presentation must win before embedded record fallback");
});
