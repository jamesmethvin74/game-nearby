import test from "node:test";
import assert from "node:assert/strict";
import { scopePolicy } from "../src/scoped-cadence-runner.js";

test("Friday game-day collection is football-only and bounded", () => {
  const policy = scopePolicy({ scope:"football-game-day", activeResultMinutes:30 });
  assert.equal(policy.where, "t.sport='football'");
  assert.equal(policy.requireGameWindow, true);
  assert.equal(policy.activeMinutes, 30);
  assert.ok(policy.maxSources <= 32);
});

test("Saturday collection is college-only, game-day-only, and bounded", () => {
  const policy = scopePolicy({ scope:"college-game-day", activeResultMinutes:30 });
  assert.equal(policy.where, "sch.level='college'");
  assert.equal(policy.requireGameWindow, true);
  assert.equal(policy.activeMinutes, 30);
  assert.ok(policy.maxSources <= 48);
});

test("ordinary daily cadence remains on the existing due-source collector", () => {
  assert.equal(scopePolicy({ scope:"all" }), null);
});
