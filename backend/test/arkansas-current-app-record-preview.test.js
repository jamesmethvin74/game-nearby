import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const rawSource = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const source = rawSource.replace(/\n\s*Promise\.allSettled\(\[refreshCatalog\(\), refreshNearby\(\)\]\);\s*\n\}\)\(\);\s*$/, "\n})();\n");
assert.notEqual(source, rawSource, "preview harness disables only automatic startup refresh");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createContext(fetchImpl) {
  const storage = new Map();
  const context = {
    window: { LOCALBLEACHERS_API_BASE: "https://record-truth-preview.example.test" },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    document: { dispatchEvent() {} },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    MutationObserver: class MutationObserver { observe() {} },
    SCHOOL_REGISTRY: [{ id:"university-of-arkansas", name:"University of Arkansas", level:"college" }],
    teams: [],
    events: [],
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
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename:"live-data.js" });
  return context;
}

test("current app preserves Arkansas 1-1 and Utah L 10-43 from unified backend truth", async () => {
  const context = createContext(async input => {
    const url = new URL(String(input));
    if (url.pathname !== "/api/v1/schools/university-of-arkansas/schedule") {
      return jsonResponse({ error:"not_found" }, 404);
    }
    return jsonResponse({
      schoolId:"university-of-arkansas",
      schoolLevel:"college",
      team_statuses:[{
        team_id:"university-of-arkansas-football-2026",
        school_id:"university-of-arkansas",
        school_name:"University of Arkansas",
        level:"college",
        sport:"football",
        gender:"men",
        season:"2026",
        overall_record:"1-1",
        conference_record:null,
        overall_games:2,
        conference_games:0,
        rank:null,
        standing_state:null,
        source:"normalized-final-games",
        record_state:"VERIFIED",
        record_audit_state:"CONTRADICTORY",
        record_verified:true,
        record_issues:[{ code:"STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE", informational:true }]
      }],
      games:[
        {
          id:"ark-north-alabama",
          school_id:"university-of-arkansas",
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
          school_id:"university-of-arkansas",
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
    });
  });

  const schedule = await context.window.LocalBleachersLive.fetchTeamSchedule("university-of-arkansas");
  const status = context.window.LocalBleachersLive.getTeamStatus("university-of-arkansas", "football", "men");
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
