import test from "node:test";
import assert from "node:assert/strict";
import { scopePolicy } from "../src/scoped-cadence-runner.js";

test("Friday game-day collection is football-only, finish-window-only, and tightly bounded", () => {
  const policy = scopePolicy({ scope:"football-game-day", activeResultMinutes:30 });
  assert.equal(policy.where, "t.sport='football'");
  assert.equal(policy.activeMinutes, 30);
  assert.ok(policy.maxSources <= 16);
  assert.equal(policy.dueMode, "active-result");
  assert.match(policy.gameWindow, /gx\.status='SCHEDULED'/);
  assert.match(policy.gameWindow, /gx\.scheduled_time_known=1/);
  assert.match(policy.gameWindow, /-120 minutes/);
  assert.doesNotMatch(policy.gameWindow, /\+12 hours/);
});

test("Saturday collection is college-only, finish-window-only, and tightly bounded", () => {
  const policy = scopePolicy({ scope:"college-game-day", activeResultMinutes:30 });
  assert.equal(policy.where, "sch.level='college'");
  assert.equal(policy.activeMinutes, 30);
  assert.ok(policy.maxSources <= 8);
  assert.equal(policy.dueMode, "active-result");
  assert.match(policy.gameWindow, /gx\.status='SCHEDULED'/);
  assert.match(policy.gameWindow, /gx\.scheduled_time_known=1/);
  for (const sport of ["football","basketball","soccer","volleyball"]) assert.match(policy.gameWindow, new RegExp(`t\\.sport='${sport}'`));
  assert.doesNotMatch(policy.gameWindow, /\+12 hours/);
});

test("ordinary 6 AM / 3 PM / 11 PM collection has a hard source fuse", () => {
  const policy = scopePolicy({ scope:"all" });
  assert.ok(policy);
  assert.equal(policy.where, "1=1");
  assert.equal(policy.dueMode, "source-refresh");
  assert.ok(policy.maxSources > 0 && policy.maxSources <= 4);
  assert.equal(policy.gameWindow, "");
});
