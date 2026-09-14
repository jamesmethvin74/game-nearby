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

test("statewide bridge loads catalog and nearby games without replacing the master schedule store", async () => {
  let revision = 1;
  const fetchImpl = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/schools") {
      return jsonResponse({
        schools: [
          { id: "df-green-forest", name: "Green Forest High School", city: "Green Forest", state: "AR", mascot: "Tigers", team_count: 1 },
          { id: "df-eureka", name: "Eureka Springs High School", city: "Eureka Springs", state: "AR", mascot: "Highlanders", team_count: 1 },
          { id: "df-valley-springs", name: "VALLEY SPRINGS HIGH SCHOOL", location_matched_name: "Valley Springs High School", city: "Valley Springs", state: "AR", mascot: null, team_count: 1 }
        ]
      });
    }
    if (url.pathname === "/api/v1/games") {
      const games = [{
        id: revision === 1 ? "game-1" : "game-2",
        canonical_event_id: revision === 1 ? "ce-1" : "ce-2",
        team_id: "df-eureka-volleyball-2026",
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
    if (url.pathname === "/api/v1/schools/df-eureka/schedule") {
      return jsonResponse({
        schoolId: "df-eureka",
        schoolLevel: "high-school",
        team_statuses: [{
          team_id: "df-eureka-volleyball-2026",
          school_id: "df-eureka",
          school_name: "Eureka Springs High School",
          level: "high-school",
          sport: "volleyball",
          gender: "girls",
          season: "2026",
          conference_id: "2a-west-volleyball",
          conference_name: "2A West",
          overall_record: "1-1",
          conference_record: null,
          overall_games: 2,
          conference_games: 0,
          rank: null,
          record_verified: true,
          record_state: "VERIFIED",
          record_audit_state: "CONTRADICTORY",
          source: "normalized-final-games",
          record_issues: [{ code:"STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE", informational:true }]
        }],
        games: [
          {
            id: "team-ce-1",
            canonical_event_id: "team-ce-1",
            school_id: "df-eureka",
            school_name: "Eureka Springs High School",
            sport: "volleyball",
            gender: "girls",
            canonical_home_school_id: "df-eureka",
            canonical_away_school_id: "df-green-forest",
            opponent: "Green Forest High School",
            scheduled_at: "2026-09-08T00:00:00.000Z",
            scheduled_time_known: 1,
            home_away: "home",
            venue: "Eureka Springs High School",
            latitude: 36.4,
            longitude: -93.7,
            status: "FINAL",
            team_score: 3,
            opponent_score: 1,
            result: "W",
            source_type: "official-conference",
            parser_type: "dragonfly-public"
          },
          {
            id: "team-ce-2",
            canonical_event_id: "team-ce-2",
            school_id: "df-eureka",
            school_name: "Eureka Springs High School",
            sport: "volleyball",
            gender: "girls",
            canonical_home_school_id: "df-green-forest",
            canonical_away_school_id: "df-eureka",
            opponent: "Green Forest High School",
            scheduled_at: "2026-09-15T00:00:00.000Z",
            scheduled_time_known: 1,
            home_away: "away",
            venue: "Green Forest High School",
            latitude: 36.3,
            longitude: -93.4,
            status: "FINAL",
            team_score: 1,
            opponent_score: 3,
            result: "L",
            source_type: "official-conference",
            parser_type: "dragonfly-public"
          }
        ]
      });
    }
    return jsonResponse({ error: "not_found" }, 404);
  };

  const context = createContext(fetchImpl);
  const first = await context.window.LocalBleachersLive.refreshAll();
  assert.equal(first.schools, 3);
  assert.equal(first.games, 1);
  assert.equal(context.SCHOOL_REGISTRY.length, 3);
  assert.equal(context.SCHOOL_REGISTRY[0].name, "Eureka Springs High School");
  assert.equal(context.SCHOOL_REGISTRY[1].name, "Green Forest High School");
  assert.equal(context.SCHOOL_REGISTRY[2].name, "Valley Springs High School");
  assert.equal(context.SCHOOL_REGISTRY[2].providerName, "VALLEY SPRINGS HIGH SCHOOL");
  assert.equal(context.teams.length, 1, "statewide schools should not be pushed into the legacy badge registry");

  assert.equal(context.events.length, 1, "nearby refresh must not replace the master schedule store");
  assert.equal(context.events[0].id, "embedded-fallback");
  let nearby = context.window.LocalBleachersLive.getNearbyEvents();
  assert.equal(nearby.length, 1);
  assert.equal(nearby[0].backendCanonicalEventId, "ce-1");
  assert.deepEqual([...nearby[0].schoolIds].sort(), ["df-eureka", "df-green-forest"]);

  revision = 2;
  assert.equal(await context.window.LocalBleachersLive.refreshNearby(), 1);
  assert.equal(context.events[0].id, "embedded-fallback", "a second nearby refresh still must not erase schedules");
  nearby = context.window.LocalBleachersLive.getNearbyEvents();
  assert.equal(nearby.length, 1);
  assert.equal(nearby[0].backendCanonicalEventId, "ce-2");

  const schedule = await context.window.LocalBleachersLive.fetchTeamSchedule("df-eureka");
  assert.equal(schedule.length, 2, "full school schedule should come from /schools/:id/schedule, not the nearby window");
  assert.equal(schedule[0].teamId, "df-eureka");
  assert.equal(schedule[0].team, "Eureka Springs High School");
  assert.equal(schedule[0].opponent, "Green Forest High School");
  assert.equal(schedule[1].home, false);

  const status = context.window.LocalBleachersLive.getTeamStatus("df-eureka", "volleyball", "girls");
  assert.equal(status.overall_record, "1-1");
  assert.equal(status.record_verified, true);
  assert.equal(status.source, "normalized-final-games");
  assert.equal(status.record_audit_state, "CONTRADICTORY", "explained stale storage may remain visible to diagnostics without replacing normalized truth");
});

test("unverified backend record state is surfaced as N/A instead of stale confidence", async () => {
  const context = createContext(async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/schools/sample/schedule") {
      return jsonResponse({
        schoolId:"sample",
        schoolLevel:"high-school",
        games:[{
          id:"sample-final",school_id:"sample",school_name:"Sample High School",sport:"football",gender:"boys",
          scheduled_at:"2026-09-12T00:00:00.000Z",status:"FINAL",team_score:21,opponent_score:14,result:"W",opponent:"Opponent"
        }],
        team_statuses:[{
          team_id:"sample-football-2026",school_id:"sample",sport:"football",gender:"boys",season:"2026",
          overall_record:"3-0",overall_games:3,conference_games:0,record_verified:false,record_state:"INCOMPLETE",
          record_audit_state:"INCOMPLETE",source:"unverified",record_issues:[{code:"STORED_RECORD_EXCEEDS_FINAL_EVIDENCE"}]
        }]
      });
    }
    return jsonResponse({ error:"not_found" },404);
  });

  const schedule=await context.window.LocalBleachersLive.fetchTeamSchedule("sample");
  assert.equal(schedule.length,1);
  const status=context.window.LocalBleachersLive.getTeamStatus("sample","football","boys");
  assert.equal(status.overall_record,null);
  assert.equal(status.record_verified,false);
  assert.equal(status.record_state,"INCOMPLETE");
});

test("statewide bridge preserves embedded fallback data when the API is unavailable", async () => {
  const context = createContext(async () => { throw new Error("network unavailable"); });
  const result = await context.window.LocalBleachersLive.refreshAll();
  assert.equal(result.schools, 0);
  assert.equal(result.games, 0);
  assert.equal(context.SCHOOL_REGISTRY.length, 1);
  assert.equal(context.SCHOOL_REGISTRY[0].id, "legacy");
  assert.equal(context.events.length, 1);
  assert.equal(context.events[0].id, "embedded-fallback");
  assert.equal(context.window.LocalBleachersLive.getNearbyEvents().length, 0);
});
