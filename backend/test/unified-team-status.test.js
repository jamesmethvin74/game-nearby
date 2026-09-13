import test from "node:test";
import assert from "node:assert/strict";
import { buildUnifiedTeamStatuses, publishedConferenceId } from "../src/m4-public-worker.js";

function emptyEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { return null; },
          async all() { return { results: [] }; }
        };
      }
    }
  };
}

function volleyballRow(overrides = {}) {
  return {
    reporting_team_id: "conway-volleyball-2026",
    team_id: "conway-volleyball-2026",
    school_id: "conway",
    school_name: "Conway High School",
    sport: "volleyball",
    gender: "girls",
    season: "2026",
    conference_id: "6a-central-volleyball",
    conference_name: "6A Central",
    wins: 10,
    losses: 6,
    ties: 0,
    conference_wins: 3,
    conference_losses: 0,
    conference_ties: 0,
    record_source: "schedule-derived",
    ...overrides
  };
}

function maxPrepsHtml({ conferenceRecord = "3-0", overallRecord = "10-6", rank = 1 } = {}) {
  return `<table><tbody><tr><td>${rank}</td><td>Conway</td><td>${conferenceRecord}</td><td>1.000</td><td>${overallRecord}</td><td>.625</td></tr></tbody></table>`;
}

async function withPublishedVolleyball(html, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/conference/6a-central/")) {
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("/ar/volleyball/")) {
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("local sport-suffixed conference ids resolve to the published conference table", () => {
  assert.equal(publishedConferenceId("6a-central-volleyball", "6A Central", "volleyball"), "6a-central");
  assert.equal(publishedConferenceId("7a-central-football-2026", "7A Central", "football"), "7a-central");
});

test("Conway team status uses the exact same standings truth as the conference page", { concurrency:false }, async () => {
  await withPublishedVolleyball(maxPrepsHtml(), async () => {
    const [status] = await buildUnifiedTeamStatuses(emptyEnv(), [volleyballRow()]);
    assert.equal(status.overall_record, "10-6");
    assert.equal(status.conference_record, "3-0");
    assert.equal(status.conference_games, 3);
    assert.equal(status.rank, 1);
    assert.equal(status.standing_state, "ranked");
    assert.equal(status.conference_name, "6A Central");
  });
});

test("known conference with no conference games reports membership but no fake standing", { concurrency:false }, async () => {
  await withPublishedVolleyball(maxPrepsHtml({ conferenceRecord:"0-0", overallRecord:"2-1", rank:1 }), async () => {
    const [status] = await buildUnifiedTeamStatuses(emptyEnv(), [volleyballRow({
      wins:2,
      losses:1,
      conference_wins:0,
      conference_losses:0,
      conference_ties:0
    })]);
    assert.equal(status.overall_record, "2-1");
    assert.equal(status.conference_name, "6A Central");
    assert.equal(status.conference_games, 0);
    assert.equal(status.conference_record, null);
    assert.equal(status.rank, null);
    assert.equal(status.standing_state, "not-started");
  });
});
