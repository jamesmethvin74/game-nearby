import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const schoolScheduleSource = await readFile(new URL("../../school-schedule.js", import.meta.url), "utf8");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function payload(status) {
  return {
    schoolId: "conway",
    team_statuses: [{
      team_id: "conway-football-2026",
      school_id: "conway",
      school_name: "Conway High School",
      sport: "football",
      gender: "boys",
      season: "2026",
      overall_record: "2-0",
      overall_games: 2,
      conference_record: "1-0",
      conference_games: 1,
      conference_membership_state: "member",
      conference_id: "7a-central-football",
      conference_name: "7A Central",
      rank: 1,
      standing_state: "ranked",
      record_verified: true,
      standings_verified: true,
      record_state: "VERIFIED",
      record_audit_state: "VERIFIED",
      record_issues: [],
      ...status
    }],
    games: []
  };
}

function createContext(responsePayload) {
  const storage = new Map();
  const presentationStatuses = new Map();
  const presentationKey = (schoolId, sport, gender = "") =>
    `${String(schoolId || "")}|${String(sport || "").toLowerCase()}|${String(gender || "").toLowerCase()}`;
  const live = {
    apiBase: "https://example.test",
    fetchTeamSchedule() {},
    getNearbyEvents() { return []; },
    ingestPresentationStatuses(statuses = [], _resolutions = [], requestedSchoolIds = []) {
      for (const status of statuses) {
        const canonicalSchoolId = String(status?.school_id || requestedSchoolIds[0] || "");
        if (!canonicalSchoolId) continue;
        presentationStatuses.set(presentationKey(canonicalSchoolId, status.sport, status.gender), status);
        for (const requestedSchoolId of requestedSchoolIds) {
          presentationStatuses.set(presentationKey(requestedSchoolId, status.sport, status.gender), status);
        }
      }
    },
    getPresentationStatus(schoolId, sport, gender = "") {
      return presentationStatuses.get(presentationKey(schoolId, sport, gender)) || null;
    },
    async primePresentationStatuses() { return new Map(presentationStatuses); }
  };
  const context = {
    window: { LocalBleachersLive: live },
    SCHOOL_REGISTRY: [{ id: "conway", name: "Conway High School", level: "high-school" }],
    followed: [],
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    document: { addEventListener() {} },
    fetch: async input => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/schools/conway/schedule") return jsonResponse(responsePayload);
      return jsonResponse({ error: "not_found" }, 404);
    },
    Response,
    URL,
    Date,
    console,
    queueMicrotask
  };
  vm.createContext(context);
  vm.runInContext(schoolScheduleSource, context, { filename: "school-schedule.js" });
  return context;
}

async function normalizedStatus(overrides = {}) {
  const context = createContext(payload(overrides));
  await context.window.LocalBleachersLive.fetchTeamSchedule("conway");
  return context.window.LocalBleachersLive.getTeamStatus("conway", "football", "boys");
}

test("M12 preserves fully verified overall, conference, and rank truth", async () => {
  const status = await normalizedStatus();
  assert.equal(status.overall_record, "2-0");
  assert.equal(status.conference_membership_state, "member");
  assert.equal(status.conference_id, "7a-central-football");
  assert.equal(status.conference_record, "1-0");
  assert.equal(status.rank, 1);
  assert.equal(status.record_verified, true);
  assert.equal(status.standings_verified, true);
});

test("M12 hides stale records and rank when record truth is unverified", async () => {
  const status = await normalizedStatus({
    record_verified: false,
    record_state: "INCOMPLETE",
    record_audit_state: "INCOMPLETE",
    record_issues: [{ code: "PUBLISHED_RECORD_EXCEEDS_FINAL_EVIDENCE" }]
  });
  assert.equal(status.overall_record, null);
  assert.equal(status.conference_record, null);
  assert.equal(status.rank, null);
  assert.equal(status.record_verified, false);
  assert.equal(status.record_issues[0]?.code, "PUBLISHED_RECORD_EXCEEDS_FINAL_EVIDENCE");
});

test("M12 hides conference identity, conference record, and rank for unknown membership", async () => {
  const status = await normalizedStatus({
    conference_membership_state: "unknown",
    conference_id: "7a-central-football",
    conference_name: "7A Central",
    conference_record: "1-0",
    rank: 1,
    standings_verified: true
  });
  assert.equal(status.overall_record, "2-0");
  assert.equal(status.conference_membership_state, "unknown");
  assert.equal(status.conference_id, null);
  assert.equal(status.conference_name, null);
  assert.equal(status.conference_record, null);
  assert.equal(status.rank, null);
  assert.equal(status.standings_verified, false);
});

test("M12 keeps verified conference record but withholds unverified rank", async () => {
  const status = await normalizedStatus({ standings_verified: false, rank: 1, standing_state: "unavailable" });
  assert.equal(status.overall_record, "2-0");
  assert.equal(status.conference_record, "1-0");
  assert.equal(status.rank, null);
  assert.equal(status.standings_verified, false);
  assert.equal(status.standing_state, "unavailable");
});