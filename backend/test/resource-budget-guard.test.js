import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const productionSmoke = await readFile(
  new URL("../../.github/workflows/production-statewide-smoke.yml", import.meta.url),
  "utf8"
);
const schoolSchedule = await readFile(
  new URL("../../school-schedule.js", import.meta.url),
  "utf8"
);

test("expensive statewide D1 audit is explicit manual-only work", () => {
  assert.match(productionSmoke, /full_statewide_record_audit:/);
  assert.match(
    productionSmoke,
    /github\.event_name == 'workflow_dispatch' && inputs\.full_statewide_record_audit == true/
  );
  assert.match(productionSmoke, /Deliberately sequential/);
  assert.doesNotMatch(productionSmoke, /Promise\.all\(Array\.from\(\{length:12\}/);
});

test("automatic production probes have bounded retries", () => {
  assert.match(productionSmoke, /Catalog attempt \$\{attempt\}\/3/);
  assert.doesNotMatch(productionSmoke, /seq 1 20/);
  assert.doesNotMatch(productionSmoke, /seq 1 28/);
});

test("one team-detail open cannot fan out across the full sport catalog", () => {
  assert.match(schoolSchedule, /MAX_TEAM_ENDPOINTS_PER_OPEN = 3/);
  assert.match(schoolSchedule, /candidatesFor\(school\)\.slice\(0, MAX_TEAM_ENDPOINTS_PER_OPEN\)/);
  assert.doesNotMatch(schoolSchedule, /Promise\.allSettled/);
  assert.doesNotMatch(schoolSchedule, /Promise\.all\(/);
  assert.match(schoolSchedule, /A 500\/429\/quota failure is not a reason to fan out/);
  assert.match(schoolSchedule, /break;/);
});

test("team schedules retain a local last-good fallback", () => {
  assert.match(schoolSchedule, /localBleachersAR:teamSchedule:v1:/);
  assert.match(schoolSchedule, /localBleachersAR:nearbyGames:v1/);
  assert.match(schoolSchedule, /saveSchedule\(schoolId, unique\)/);
  assert.match(schoolSchedule, /fallbackEvents\(schoolId\)/);
});
