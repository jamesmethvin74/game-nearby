import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const resilience = await readFile(new URL("../../live-resilience.js", import.meta.url), "utf8");
const teamsCatalog = await readFile(new URL("../../teams-catalog-bootstrap.js", import.meta.url), "utf8");

test("Home persists the statewide catalog into the same v2 Teams cache key", () => {
  assert.match(resilience, /localBleachersAR:schoolCatalog:v2/);
  assert.match(teamsCatalog, /localBleachersAR:schoolCatalog:v2/);
  assert.match(resilience, /SCHOOL_REGISTRY\.length < MIN_STATEWIDE_CATALOG/);
});

test("Home keeps a durable last-good nearby event set", () => {
  assert.match(resilience, /localBleachersAR:nearbyGames:v1/);
  assert.match(resilience, /fallbackEvents/);
  assert.match(resilience, /live\.getNearbyEvents = \(\) =>/);
  assert.match(resilience, /current\.length \? current : cloneEvents\(fallbackEvents\)/);
});
