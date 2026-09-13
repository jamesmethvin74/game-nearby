import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { legacyCollegeSchoolId, localSchoolId, resolvedGameForSchool } from "../src/m4-public-worker.js";

test("school schedule route recognizes explicit school-level reads", () => {
  assert.equal(localSchoolId("/api/v1/schools/uca/schedule"), "uca");
  assert.equal(localSchoolId("/api/v1/schools/ua-rich-mountain/schedule"), "ua-rich-mountain");
  assert.equal(localSchoolId("/api/v1/teams/uca-volleyball-women-2026/schedule"), null);
  assert.equal(localSchoolId("/api/v1/schools"), null);
});

test("M4 college read compatibility only recognizes legacy volleyball schedule-shaped requests", () => {
  assert.equal(legacyCollegeSchoolId("/api/v1/teams/cbc-volleyball-2026/schedule"), "cbc");
  assert.equal(legacyCollegeSchoolId("/api/v1/teams/ua-rich-mountain-volleyball-2026/schedule"), "ua-rich-mountain");
  assert.equal(legacyCollegeSchoolId("/api/v1/teams/cbc-basketball-men-2026/schedule"), null);
  assert.equal(legacyCollegeSchoolId("/api/v1/games"), null);
});

test("school schedule preserves sport/gender identity and canonical result orientation", () => {
  const row = {
    id:"raw-1",sport:"basketball",gender:"women",season:"2026",
    canonical_event_id:"canonical-1",
    canonical_home_school_id:"cbc",canonical_away_school_id:"hendrix",
    canonical_home_name:"Central Baptist",canonical_away_name:"Hendrix",
    canonical_scheduled_at:"2026-11-01T01:00:00.000Z",canonical_time_known:1,
    canonical_venue:"Reddin Fieldhouse",canonical_status:"FINAL",
    canonical_home_score:74,canonical_away_score:68,
    canonical_latitude:35.09,canonical_longitude:-92.44,
    status:"SCHEDULED",team_score:null,opponent_score:null,home_away:"unknown"
  };
  const game = resolvedGameForSchool(row,"cbc");
  assert.equal(game.sport,"basketball");
  assert.equal(game.gender,"women");
  assert.equal(game.opponent,"Hendrix");
  assert.equal(game.home_away,"home");
  assert.equal(game.status,"FINAL");
  assert.equal(game.team_score,74);
  assert.equal(game.opponent_score,68);
  assert.equal(game.result,"W");
  assert.equal(game.latitude,35.09);
});

test("school schedule query is tightly scoped but preserves retained materialized source rows", () => {
  const source = fs.readFileSync(new URL("../src/m4-public-worker.js", import.meta.url), "utf8");
  assert.match(source, /school\.catalog_scope !== "local"/);
  assert.match(source, /requiredLevel && school\.level !== requiredLevel/);
  assert.match(source, /JOIN sources src ON src\.id=g\.source_id\n/);
  assert.doesNotMatch(source, /JOIN sources src ON src\.id=g\.source_id AND src\.enabled=1/);
  assert.match(source, /WHERE t\.school_id=\? AND t\.active=1 AND t\.season='2026'/);
  assert.match(source, /PARTITION BY t\.id,COALESCE\(g\.canonical_event_id,g\.id\)/);
  assert.match(source, /t\.id AS reporting_team_id,t\.sport,t\.gender,t\.season,t\.conference_id/);
  assert.doesNotMatch(source, /UPDATE\s+games|INSERT\s+INTO\s+games|DELETE\s+FROM\s+games/i);
});

test("configured Worker preserves M4 underneath the M8 and protected logo wrappers", () => {
  const wrangler = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const m8Wrapper = fs.readFileSync(new URL("../src/m8-worker.js", import.meta.url), "utf8");
  const logoWrapper = fs.readFileSync(new URL("../src/logo-bootstrap-worker.js", import.meta.url), "utf8");
  const source = fs.readFileSync(new URL("../src/m4-public-worker.js", import.meta.url), "utf8");
  assert.match(wrangler, /"main"\s*:\s*"src\/m8-worker\.js"/);
  assert.match(m8Wrapper, /import app from "\.\/logo-bootstrap-worker\.js"/);
  assert.match(m8Wrapper, /return app\.scheduled\(controller, env, ctx\)/);
  assert.match(logoWrapper, /import app from "\.\/m4-public-worker\.js"/);
  assert.match(logoWrapper, /return app\.scheduled\(controller, env, ctx\)/);
  assert.match(source, /import app from "\.\/d1-usage-public-worker\.js"/);
  assert.match(source, /return app\.scheduled\(controller, env, ctx\)/);
});
