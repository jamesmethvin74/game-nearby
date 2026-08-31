import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const rawSource = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const source = rawSource.replace(/\n\s*Promise\.allSettled\(\[refreshCatalog\(\), refreshNearby\(\)\]\);\s*\n\}\)\(\);\s*$/, "\n})();\n");
assert.notEqual(source, rawSource, "test harness should disable only the automatic startup refresh");

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createContext(fetchImpl) {
  const context = {
    window: { LOCALBLEACHERS_API_BASE: "https://api.example.test" },
    localStorage: createStorage(),
    document: { dispatchEvent() {} },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    MutationObserver: class MutationObserver {
      constructor(callback) { this.callback = callback; }
      observe() {}
    },
    SCHOOL_REGISTRY: [
      { id: "legacy", name: "Legacy School", subtitle: "Fallback" }
    ],
    teams: [
      { id: "legacy", name: "Legacy School", short: "L" }
    ],
    events: [
      {
        id: "embedded-fallback",
        teamId: "legacy",
        schoolIds: ["legacy"],
        team: "Legacy School",
        sport: "volleyball",
        gender: "girls",
        level: "high-school",
        opponent: "Fallback Opponent",
        date: "2026-09-01T00:00:00.000Z",
        home: true,
        lat: 35.1,
        lon: -92.4,
        venue: "Fallback Gym"
      }
    ],
    center: { lat: 36.3293749879, lon: -93.4343223399 },
    radiusEl: { value: "25", addEventListener() {} },
    locationLabelEl: {},
    dialog: { open: false },
    renderTeamChoices() {},
    render() {},
    sourceLabel() { return "fallback"; },
    fetch: fetchImpl,
    AbortController,
    Response,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "live-data.js" });
  return context;
}

test("statewide bridge loads the public school catalog and nearby games without hardcoded pilot teams", async () => {
  let revision = 1;
  const fetchImpl = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/schools") {
      return jsonResponse({
        schools: [
          { id: "df-green-forest", name: "Green Forest High School", city: "Green Forest", state: "AR", mascot: "Tigers", team_count: 1 },
          { id: "df-eureka", name: "Eureka Springs High School", city: "Eureka Springs", state: "AR", mascot: "Highlanders", team_count: 1 }
        ]
      });
    }
    if (url.pathname === "/api/v1/games") {
      const games = [{
        id: revision === 1 ? "game-1" : "game-2",
        canonical_event_id: revision === 1 ? "ce-1" : "ce-2",
        school_id: "df-eureka",
        school_name: "Eureka Springs High School",
        canonical_home_school_id: "df-green-forest",
        canonical_away_school_id: "df-eureka",
        opponent: "Green Forest High School",
        sport: "volleyball",
        gender: "girls",
        level: "high-school",
        scheduled_at: revision === 1 ? "2026-09-03T00:00:00.000Z" : "2026-09-05T00:00:00.000Z",
        scheduled_time_known: 1,
        home_away: "away",
        venue: "GREEN FOREST HIGH SCHOOL",
        latitude: 36.3293749879,
        longitude: -93.4343223399,
        status: "SCHEDULED",
        source_type: "official-conference",
        parser_type: "dragonfly-public",
        data_trust: "CORROBORATED",
        conflict_count: 0
      }];
      return jsonResponse({ games });
    }
    return jsonResponse({ error: "not_found" }, 404);
  };

  const context = createContext(fetchImpl);
  const first = await context.window.LocalBleachersLive.refreshAll();
  assert.deepEqual(first, { schools: 2, games: 1 });
  assert.equal(context.SCHOOL_REGISTRY.length, 2);
  assert.equal(context.SCHOOL_REGISTRY[0].name, "Eureka Springs High School");
  assert.equal(context.SCHOOL_REGISTRY[1].name, "Green Forest High School");
  assert.equal(context.teams.some(team => team.id === "df-green-forest"), true);
  assert.equal(context.events.length, 1);
  assert.equal(context.events[0].liveData, true);
  assert.equal(context.events[0].backendCanonicalEventId, "ce-1");
  assert.deepEqual([...context.events[0].schoolIds].sort(), ["df-eureka", "df-green-forest"]);
  assert.equal(context.events[0].lat, 36.3293749879);
  assert.equal(context.events[0].lon, -93.4343223399);

  revision = 2;
  assert.equal(await context.window.LocalBleachersLive.refreshNearby(), 1);
  assert.equal(context.events.length, 1, "new nearby response replaces the previous live window");
  assert.equal(context.events[0].backendCanonicalEventId, "ce-2");
});

test("statewide bridge preserves embedded fallback data when the API is unavailable", async () => {
  const context = createContext(async () => { throw new Error("network unavailable"); });
  const result = await context.window.LocalBleachersLive.refreshAll();
  assert.deepEqual(result, { schools: 0, games: 0 });
  assert.equal(context.SCHOOL_REGISTRY.length, 1);
  assert.equal(context.SCHOOL_REGISTRY[0].id, "legacy");
  assert.equal(context.events.length, 1);
  assert.equal(context.events[0].id, "embedded-fallback");
  assert.equal(context.events[0].liveData, undefined);
});
