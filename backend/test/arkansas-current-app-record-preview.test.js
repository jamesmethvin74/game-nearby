import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const rawLiveSource = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const liveSource = rawLiveSource.replace(/\n\s*Promise\.allSettled\(\[refreshCatalog\(\), refreshNearby\(\)\]\);\s*\n\}\)\(\);\s*$/, "\n})();\n");
const schoolScheduleSource = await readFile(new URL("../../school-schedule.js", import.meta.url), "utf8");
assert.notEqual(liveSource, rawLiveSource, "preview harness disables only automatic startup refresh");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type":"application/json" } });
}

function createContext(fetchImpl) {
  const storage = new Map();
  const listeners = new Map();
  const context = {
    window: { LOCALBLEACHERS_API_BASE:"https://record-truth-preview.example.test" },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    document: {
      dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); },
      addEventListener(type, handler) {
        const current = listeners.get(type) || [];
        current.push(handler);
        listeners.set(type, current);
      }
    },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    MutationObserver: class MutationObserver { observe() {} },
    SCHOOL_REGISTRY: [{ id:"uark", name:"University of Arkansas", level:"college" }],
    teams: [],
    events: [],
    followed: [],
    center: { lat:36.06, lon:-94.16 },
    radiusEl: { value:"25", addEventListener() {} },
    locationLabelEl: {},
    dialog: { open:false },
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
    queueMicrotask,
    console
  };
  vm.createContext(context);
  vm.runInContext(liveSource, context, { filename:"live-data.js" });
  vm.runInContext(schoolScheduleSource, context, { filename:"school-schedule.js" });
  return context;
}

function arkansasPayload({ verified = true } = {}) {
  return {
    schoolId:"uark",
    schoolLevel:"college",
    team_statuses:[{
      team_id:"uark-football-2026",
      school_id:"uark",
      school_name:"University of Arkansas",
      level:"college",
      sport:"football",
      gender:"men",
      season:"2026",
      overall_record: verified ? "1-1" : "2-0",
      conference_record:null,
      overall_games:2,
      conference_games:0,
      rank:null,
      standing_state:null,
      source: verified ? "normalized-final-games" : "unverified",
      record_state: verified ? "VERIFIED" : "INCOMPLETE",
      record_audit_state: verified ? "CONTRADICTORY" : "INCOMPLETE",
      record_verified:verified,
      record_issues: verified
        ? [{ code:"STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE", informational:true }]
        : [{ code:"STORED_RECORD_EXCEEDS_FINAL_EVIDENCE" }]
    }],
    games:[
      {
        id:"ark-north-alabama",
        reporting_team_id:"uark-football-2026",
        school_id:"uark",
        school_name:"University of Arkansas",
        sport:"football",
        gender:"men",
        scheduled_at:"2026-09-05T23:00:00.000Z",
        status:"FINAL",
        result:"W",
        team_score:31,
        opponent_score:14,
        opponent:"North Alabama",
        home_away:"home",
        source_type:"official-athletics",
        parser_type:"arkansas-razorbacks"
      },
      {
        id:"ark-utah",
        reporting_team_id:"uark-football-2026",
        school_id:"uark",
        school_name:"University of Arkansas",
        sport:"football",
        gender:"men",
        scheduled_at:"2026-09-12T23:00:00.000Z",
        status:"FINAL",
        result:"L",
        team_score:10,
        opponent_score:43,
        opponent:"Utah",
        home_away:"away",
        source_type:"official-athletics",
        parser_type:"arkansas-razorbacks"
      }
    ]
  };
}

test("installed app load order preserves Arkansas 1-1 and Utah L 10-43 from unified backend truth", async () => {
  const context = createContext(async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/schools/uark/schedule") return jsonResponse(arkansasPayload());
    return jsonResponse({ error:"not_found" }, 404);
  });

  const schedule = await context.window.LocalBleachersLive.fetchTeamSchedule("uark");
  const status = context.window.LocalBleachersLive.getTeamStatus("uark", "football", "men");
  const utah = schedule.find(game => game.opponent === "Utah");

  assert.equal(status.overall_record, "1-1");
  assert.equal(status.record_verified, true);
  assert.equal(status.source, "normalized-final-games");
  assert.equal(status.record_audit_state, "CONTRADICTORY", "stale 2-0 storage remains diagnostic only");
  assert.ok(utah);
  assert.equal(utah.status, "FINAL");
  assert.equal(utah.result, "L");
  assert.equal(utah.teamScore, 10);
  assert.equal(utah.opponentScore, 43);
});

test("installed app hides a stale record when backend marks evidence incomplete", async () => {
  const context = createContext(async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/schools/uark/schedule") return jsonResponse(arkansasPayload({ verified:false }));
    return jsonResponse({ error:"not_found" }, 404);
  });

  await context.window.LocalBleachersLive.fetchTeamSchedule("uark");
  const status = context.window.LocalBleachersLive.getTeamStatus("uark", "football", "men");
  assert.equal(status.record_verified, false);
  assert.equal(status.record_state, "INCOMPLETE");
  assert.equal(status.overall_record, null, "Team Detail renders N/A instead of stale 2-0");
  assert.equal(status.conference_record, null);
});
