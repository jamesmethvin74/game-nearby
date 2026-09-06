import test from "node:test";
import assert from "node:assert/strict";
import { parseFearlessFridaySeasonRecord, reconcileFootballGameRecords, reconcileFootballOverallRecords } from "../src/football-record-reconciliation.js";

const conwayHtml = `
  <main>
    <h3>2026</h3>
    <div>Record: 1 - 0 - 0</div>
    <div>Conf Record: 0 - 0 - 0</div>
    <div>Friday, August 28, 2026</div>
    <div>MO-Capital City</div><div>Conway</div><div>7</div><div>45</div><div>Final</div>
  </main>`;

const conwayTwoGameHtml = `
  <main>
    <h3>2026</h3>
    <div>Record: 1 - 1 - 0</div>
    <div>Conf Record: 0 - 0 - 0</div>
    <div>Friday, August 28, 2026</div>
    <div>MO-Capital City</div><div>Conway</div><div>7</div><div>45</div><div>Final</div>
    <div>Friday, September 4, 2026</div>
    <div>Conway</div><div>Bentonville</div><div>14</div><div>20</div><div>Final</div>
  </main>`;

const bryantOneGameHtml = `
  <main>
    <h3>2026</h3>
    <div>Record: 0 - 1 - 0</div>
    <div>Conf Record: 0 - 0 - 0</div>
  </main>`;

test("parses the current Fearless Friday season record", () => {
  assert.deepEqual(parseFearlessFridaySeasonRecord(conwayHtml, 2026), {
    wins: 1,
    losses: 0,
    ties: 0,
    games: 1,
    record: "1-0"
  });
});

test("reconciles a stale nonzero football overall record when the secondary source has more games", async () => {
  const result = {
    conference: {
      id: "7a-central",
      name: "7A Central",
      sport: "football",
      standings_method: "published",
      source_url: "https://www.maxpreps.com/ar/football/26-27/conference/7a-central/"
    },
    standings: [
      {
        rank: 1,
        school_name: "Conway",
        conference_record: "0-0",
        overall_record: "0-1",
        overall_pct: ".000",
        method: "published"
      },
      {
        rank: 1,
        school_name: "Bryant",
        conference_record: "0-0",
        overall_record: "0-1",
        overall_pct: ".000",
        method: "published"
      }
    ]
  };

  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    if (String(url).includes("/schools/conway/")) return new Response(conwayTwoGameHtml, { status: 200 });
    if (String(url).includes("/schools/bryant/")) return new Response(bryantOneGameHtml, { status: 200 });
    return new Response("", { status: 404 });
  };

  const reconciled = await reconcileFootballOverallRecords(result, { sport: "football", fetchFn, season: 2026 });
  const conway = reconciled.standings.find(row => row.school_name === "Conway");
  const bryant = reconciled.standings.find(row => row.school_name === "Bryant");

  assert.equal(calls.length, 2, "the small conference cohort should be checked for record completeness");
  assert.equal(conway.overall_record, "1-1");
  assert.equal(conway.conference_record, "0-0");
  assert.equal(conway.method, "published+reconciled");
  assert.equal(conway.overall_record_source, "Fearless Friday");
  assert.equal(bryant.overall_record, "0-1", "an equally complete published record should not be replaced");
  assert.equal(reconciled.conference.secondary_source_name, "Fearless Friday");
});

test("reconciles a stale 0-0 football overall record without changing conference record", async () => {
  const result = {
    conference: { id: "7a-central", name: "7A Central", sport: "football", standings_method: "published" },
    standings: [{ school_name: "Conway", conference_record: "0-0", overall_record: "0-0", overall_pct: ".000", method: "published" }]
  };
  const reconciled = await reconcileFootballOverallRecords(result, {
    sport: "football",
    fetchFn: async () => new Response(conwayHtml, { status: 200 }),
    season: 2026
  });
  assert.equal(reconciled.standings[0].overall_record, "1-0");
  assert.equal(reconciled.standings[0].conference_record, "0-0");
});

test("reconciles stale Home card football records without changing conference record", async () => {
  const games = [
    {
      id: "conway-bentonville",
      team_id: "conway-football-2026",
      school_name: "Conway High School",
      level: "high-school",
      sport: "football",
      season: "2026",
      wins: 0,
      losses: 0,
      ties: 0,
      conference_wins: 0,
      conference_losses: 0,
      conference_ties: 0
    },
    {
      id: "conway-marion",
      team_id: "conway-football-2026",
      school_name: "Conway High School",
      level: "high-school",
      sport: "football",
      season: "2026",
      wins: 0,
      losses: 0,
      ties: 0,
      conference_wins: 0,
      conference_losses: 0,
      conference_ties: 0
    }
  ];
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    return new Response(conwayHtml, { status: 200 });
  };

  const reconciled = await reconcileFootballGameRecords(games, { fetchFn });

  assert.equal(calls.length, 1, "one school should only be checked once even when multiple cards exist");
  assert.match(calls[0], /fearlessfriday\.com\/schools\/conway\//);
  for (const game of reconciled) {
    assert.equal(game.wins, 1);
    assert.equal(game.losses, 0);
    assert.equal(game.ties, 0);
    assert.equal(game.conference_wins, 0);
    assert.equal(game.conference_losses, 0);
    assert.equal(game.overall_record_source, "Fearless Friday");
  }
});

test("does not cross-check non-football or already-played Home card records", async () => {
  const games = [
    { team_id: "conway-volleyball-2026", school_name: "Conway High School", level: "high-school", sport: "volleyball", wins: 0, losses: 0, ties: 0 },
    { team_id: "bryant-football-2026", school_name: "Bryant High School", level: "high-school", sport: "football", wins: 0, losses: 1, ties: 0 }
  ];
  await reconcileFootballGameRecords(games, {
    fetchFn: async () => { throw new Error("should not fetch"); }
  });
  assert.equal(games[0].wins, 0);
  assert.equal(games[1].losses, 1);
});

test("does not alter volleyball standings", async () => {
  const result = { conference: { sport: "volleyball" }, standings: [{ school_name: "Conway", overall_record: "0-0" }] };
  const same = await reconcileFootballOverallRecords(result, {
    sport: "volleyball",
    fetchFn: async () => { throw new Error("should not fetch"); }
  });
  assert.equal(same.standings[0].overall_record, "0-0");
});
