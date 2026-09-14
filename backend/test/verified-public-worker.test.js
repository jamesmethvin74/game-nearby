import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  correctSchedulePayload,
  orientFinalScoreToExplicitResult,
  previewHtml,
  rewritePublicRead
} from "../src/m8-worker.js";

function arkansasGame(overrides = {}) {
  return {
    id: "game",
    reporting_team_id: "uark-football-men-2026",
    team_id: "uark-football-men-2026",
    school_id: "uark",
    sport: "football",
    gender: "men",
    season: "2026",
    status: "FINAL",
    counts_for_record: 1,
    conference_game: 0,
    wins: 2,
    losses: 0,
    ties: 0,
    ...overrides
  };
}

test("explicit Arkansas loss corrects stale winner-first numeric orientation", () => {
  const row = orientFinalScoreToExplicitResult(arkansasGame({
    id: "utah",
    opponent: "Utah",
    result: "L",
    team_score: 43,
    opponent_score: 10
  }));

  assert.equal(row.result, "L");
  assert.equal(row.team_score, 10);
  assert.equal(row.opponent_score, 43);
  assert.equal(row.score_orientation_corrected, true);
});

test("Arkansas visible North Alabama win plus Utah loss produces 1-1, not stale 2-0", () => {
  const payload = correctSchedulePayload({
    schoolId: "uark",
    schoolLevel: "college",
    games: [
      arkansasGame({
        id: "north-alabama",
        opponent: "North Alabama",
        result: "W",
        team_score: 31,
        opponent_score: 14
      }),
      arkansasGame({
        id: "utah",
        opponent: "Utah",
        result: "L",
        team_score: 43,
        opponent_score: 10
      })
    ],
    team_statuses: [{
      team_id: "uark-football-men-2026",
      sport: "football",
      gender: "men",
      overall_record: "2-0",
      overall_games: 2
    }]
  });

  const utah = payload.games.find(game => game.id === "utah");
  assert.equal(utah.team_score, 10);
  assert.equal(utah.opponent_score, 43);
  assert.equal(utah.wins, 1);
  assert.equal(utah.losses, 1);
  assert.equal(payload.team_statuses[0].overall_record, "1-1");
  assert.equal(payload.team_statuses[0].overall_games, 2);
});

test("final public school catalog restores the signed same-origin relay after legacy direct overrides", async () => {
  const request = new Request("https://branch-preview.example/api/v1/schools");
  const upstream = new Response(JSON.stringify({
    schools: [{
      id: "asu-mid-south",
      name: "Arkansas State University Mid-South",
      level: "college",
      logo_url: "https://pbs.twimg.com/profile_images/1935045051224080384/8pfQBpjq.jpg"
    }]
  }), { status: 200, headers: { "content-type":"application/json" } });

  const response = await rewritePublicRead(request, upstream, { LOGO_RELAY_SECRET:"test-secret" });
  const body = await response.json();
  const logo = new URL(body.schools[0].logo_url);
  assert.equal(logo.origin, "https://branch-preview.example");
  assert.equal(logo.pathname, "/api/v1/logo-relay/asu-mid-south");
  assert.equal(response.headers.get("x-localbleachers-logo-delivery"), "same-origin-relay-v1");
});

test("branch preview explicitly exposes the user-visible pass conditions", () => {
  const html = previewHtml();
  assert.match(html, /BRANCH PREVIEW/);
  assert.match(html, /Arkansas football shows <strong>1-1<\/strong>/);
  assert.match(html, /Utah renders <strong>L 10-43<\/strong>/);
  assert.match(html, /colleges/);
});

test("Cloudflare entrypoint remains M8 while M8 owns the final read corrections", async () => {
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const m8 = await readFile(new URL("../src/m8-worker.js", import.meta.url), "utf8");
  assert.match(wrangler, /"main": "src\/m8-worker\.js"/);
  assert.match(m8, /return rewritePublicRead\(request, upstream, env\)/);
  assert.match(m8, /applyLogoRelays/);
  assert.match(m8, /orientFinalScoreToExplicitResult/);
});