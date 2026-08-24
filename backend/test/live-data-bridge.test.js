import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const rawSource = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const source = rawSource.replace(/\n\s*refreshAll\(\);\s*\n\}\)\(\);\s*$/, "\n})();\n");
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
    events: [
      {
        id: "embedded-uca-soccer",
        teamId: "uca",
        team: "UCA Bears",
        sport: "soccer",
        gender: "men",
        opponent: "Drake",
        date: "2026-08-20T00:00:00.000Z",
        home: false,
        lat: 41.59,
        lon: -93.61,
        venue: "Fallback Field",
        ticketUrl: "https://tickets.example.test"
      },
      {
        id: "unrelated",
        teamId: "hendrix",
        team: "Hendrix Warriors",
        sport: "soccer",
        gender: "men",
        opponent: "Test Opponent",
        date: "2026-09-01T00:00:00.000Z",
        home: true,
        lat: 35.1,
        lon: -92.44,
        venue: "Unrelated Venue"
      }
    ],
    TEAM_STATUS: {
      "uca|soccer|men": {
        overall: "0-0",
        conference: "0-0",
        standing: "Preseason",
        conferenceName: "ASUN Conference"
      }
    },
    render() {},
    fetch: fetchImpl,
    AbortController,
    Response,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "live-data.js" });
  return context;
}

test("live bridge replaces pilot data and reflects a later backend response without frontend code changes", async () => {
  let revision = 1;
  const fetchImpl = async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/teams/uca-mens-soccer-2026") {
      return jsonResponse({
        team: {
          id: "uca-mens-soccer-2026",
          level: "college",
          conference_name: "ASUN Conference",
          school_latitude: 35.0809,
          school_longitude: -92.4590,
          source_url: "https://ucasports.com/sports/mens-soccer/schedule/2026",
          last_successful_fetch_at: "2026-08-24T21:00:00.000Z"
        },
        record: revision === 1
          ? { wins: 0, losses: 0, ties: 1, conference_wins: 0, conference_losses: 0, conference_ties: 0 }
          : { wins: 1, losses: 0, ties: 1, conference_wins: 0, conference_losses: 0, conference_ties: 0 }
      });
    }
    if (path === "/api/v1/teams/uca-mens-soccer-2026/schedule") {
      const games = [{
        id: "uca-soccer-drake",
        opponent: "Drake",
        scheduled_at: "2026-08-20T23:00:00.000Z",
        scheduled_time_known: 1,
        home_away: "away",
        venue: "Drake Stadium",
        latitude: null,
        longitude: null,
        status: "FINAL",
        team_score: 1,
        opponent_score: 1,
        result: "T",
        conference_game: 0,
        notes: "",
        source_url: "https://ucasports.com/sports/mens-soccer/schedule/2026",
        source_updated_at: "2026-08-24T21:00:00.000Z"
      }];
      if (revision === 2) games.push({
        id: "uca-soccer-second",
        opponent: "Second Opponent",
        scheduled_at: "2026-08-23T23:00:00.000Z",
        scheduled_time_known: 1,
        home_away: "home",
        venue: "Bill Stephens Track/Soccer Complex",
        latitude: 35.0767,
        longitude: -92.4545,
        status: "FINAL",
        team_score: 2,
        opponent_score: 0,
        result: "W",
        conference_game: 0,
        notes: "",
        source_url: "https://ucasports.com/sports/mens-soccer/schedule/2026",
        source_updated_at: "2026-08-24T22:00:00.000Z"
      });
      return jsonResponse({ teamId: "uca-mens-soccer-2026", games });
    }
    return jsonResponse({ error: "not_found" }, 404);
  };

  const context = createContext(fetchImpl);
  assert.equal(await context.window.LocalBleachersLive.refreshTeam("uca-mens-soccer-2026"), true);

  let liveGames = context.events.filter(event => event.teamId === "uca" && event.sport === "soccer" && event.gender === "men");
  assert.equal(liveGames.length, 1);
  assert.equal(liveGames[0].liveData, true);
  assert.equal(liveGames[0].result, "T");
  assert.equal(liveGames[0].ticketUrl, "https://tickets.example.test", "embedded event remains a ticket/location fallback");
  assert.equal(context.TEAM_STATUS["uca|soccer|men"].overall, "0-0-1");
  assert.equal(context.events.some(event => event.id === "unrelated"), true, "unrelated embedded data is untouched");

  revision = 2;
  assert.equal(await context.window.LocalBleachersLive.refreshTeam("uca-mens-soccer-2026"), true);
  liveGames = context.events.filter(event => event.teamId === "uca" && event.sport === "soccer" && event.gender === "men");
  assert.equal(liveGames.length, 2, "a later backend response replaces the previous live schedule without a frontend deploy");
  assert.equal(context.TEAM_STATUS["uca|soccer|men"].overall, "1-0-1");
});

test("live bridge preserves embedded data when the API is unavailable", async () => {
  const context = createContext(async () => { throw new Error("network unavailable"); });
  assert.equal(await context.window.LocalBleachersLive.refreshTeam("uca-mens-soccer-2026"), false);
  const fallback = context.events.find(event => event.id === "embedded-uca-soccer");
  assert.ok(fallback);
  assert.equal(fallback.liveData, undefined);
  assert.equal(context.TEAM_STATUS["uca|soccer|men"].overall, "0-0");
});
