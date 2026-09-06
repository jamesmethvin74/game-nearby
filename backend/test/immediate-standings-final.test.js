import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRecordsFromInputs } from "../src/record-rebuild.js";
import {
  buildCalculatedStandings,
  overlayCalculatedStandings,
  rebuildStandingsForTeams
} from "../src/calculated-standings.js";

function footballTeam(id, schoolId, conferenceId) {
  return { id, school_id: schoolId, sport: "football", gender: "boys", season: "2026", conference_id: conferenceId };
}

function conwayBentonvilleFinal(reportingTeamId) {
  return {
    id: "ce-conway-bentonville-2026-09-04",
    reporting_team_id: reportingTeamId,
    sport: "football",
    gender: "boys",
    season: "2026",
    home_school_id: "conway",
    away_school_id: "bentonville",
    home_name: "Conway High School",
    away_name: "Bentonville High School",
    scheduled_at: "2026-09-05T00:00:00.000Z",
    status: "FINAL",
    home_score: 14,
    away_score: 20,
    conference_game: 0,
    counts_for_record: 1,
    trust_state: "CORROBORATED"
  };
}

test("Conway 14 Bentonville 20 FINAL updates both overall records but not conference records", () => {
  const conway = footballTeam("conway-football-2026", "conway", "7a-central");
  const bentonville = footballTeam("bentonville-football-2026", "bentonville", "7a-west");
  const built = buildRecordsFromInputs({
    teams: [conway, bentonville],
    canonicals: [
      conwayBentonvilleFinal(conway.id),
      conwayBentonvilleFinal(bentonville.id)
    ],
    raw: []
  });

  const byTeam = new Map(built.map(item => [item.team.id, item.record]));
  assert.deepEqual(byTeam.get(conway.id), {
    wins: 0,
    losses: 1,
    ties: 0,
    conference_wins: 0,
    conference_losses: 0,
    conference_ties: 0,
    scored_finals: 1
  });
  assert.deepEqual(byTeam.get(bentonville.id), {
    wins: 1,
    losses: 0,
    ties: 0,
    conference_wins: 0,
    conference_losses: 0,
    conference_ties: 0,
    scored_finals: 1
  });

  const conwayStanding = buildCalculatedStandings([{
    team_id: conway.id,
    school_name: "Conway",
    ...byTeam.get(conway.id)
  }])[0];
  const bentonvilleStanding = buildCalculatedStandings([{
    team_id: bentonville.id,
    school_name: "Bentonville",
    ...byTeam.get(bentonville.id)
  }])[0];
  assert.equal(conwayStanding.overall_record, "0-1");
  assert.equal(conwayStanding.conference_record, "0-0");
  assert.equal(bentonvilleStanding.overall_record, "1-0");
  assert.equal(bentonvilleStanding.conference_record, "0-0");
});

test("a conference FINAL immediately changes calculated conference order", () => {
  const standings = buildCalculatedStandings([
    { team_id: "conway", school_name: "Conway", wins: 3, losses: 1, ties: 0, conference_wins: 2, conference_losses: 0, conference_ties: 0 },
    { team_id: "bryant", school_name: "Bryant", wins: 3, losses: 1, ties: 0, conference_wins: 1, conference_losses: 1, conference_ties: 0 },
    { team_id: "cabot", school_name: "Cabot", wins: 2, losses: 2, ties: 0, conference_wins: 1, conference_losses: 1, conference_ties: 0 }
  ]);
  assert.deepEqual(standings.map(row => [row.school_name, row.rank, row.conference_record]), [
    ["Conway", 1, "2-0"],
    ["Bryant", 2, "1-1"],
    ["Cabot", 3, "1-1"]
  ]);
});

test("partial local 7A Central standings overlay the full published conference roster", () => {
  const publishedNames = [
    "North Little Rock",
    "Northside",
    "Little Rock Christian Academy",
    "Pulaski Academy",
    "Conway",
    "Cabot",
    "Bryant",
    "Central"
  ];
  const published = {
    conference: {
      id: "7a-central",
      name: "7A Central",
      sport: "football",
      standings_method: "published",
      source_url: "https://www.maxpreps.com/ar/football/26-27/conference/7a-central/"
    },
    standings: publishedNames.map(name => ({
      rank: 1,
      school_name: name,
      conference_record: "0-0",
      overall_record: name === "Conway" ? "1-0" : "0-0",
      conference_pct: ".000",
      overall_pct: name === "Conway" ? "1.000" : ".000",
      method: "published"
    }))
  };
  const calculated = {
    conference: {
      id: "7a-central",
      name: "7A Central",
      sport: "football",
      standings_method: "calculated",
      coverage_complete: false
    },
    standings: [{
      rank: 1,
      team_id: "conway-football-2026",
      school_name: "Conway High School",
      conference_record: "0-0",
      overall_record: "0-1",
      conference_pct: ".000",
      overall_pct: ".000",
      method: "calculated"
    }]
  };

  const merged = overlayCalculatedStandings(published, calculated);
  assert.equal(merged.standings.length, 8, "partial local coverage must not collapse 7A Central to Conway only");
  assert.deepEqual(new Set(merged.standings.map(row => row.school_name)), new Set(publishedNames));
  const conway = merged.standings.find(row => row.school_name === "Conway");
  assert.equal(conway.overall_record, "0-1", "canonical local result must override stale published record");
  assert.equal(conway.conference_record, "0-0");
  assert.equal(conway.method, "calculated");
  assert.equal(merged.conference.canonical_overlay, true);
  assert.equal(merged.conference.local_coverage_complete, false);
});

test("canonical conference results rerank the combined published roster immediately", () => {
  const published = {
    conference: { id: "7a-central", name: "7A Central", sport: "football" },
    standings: [
      { rank: 1, school_name: "Bryant", conference_record: "0-0", overall_record: "2-0", method: "published" },
      { rank: 1, school_name: "Conway", conference_record: "0-0", overall_record: "1-1", method: "published" },
      { rank: 1, school_name: "Cabot", conference_record: "0-0", overall_record: "0-2", method: "published" }
    ]
  };
  const calculated = {
    conference: { id: "7a-central", coverage_complete: false },
    standings: [
      { team_id: "conway-football-2026", school_name: "Conway High School", conference_record: "1-0", overall_record: "2-1", method: "calculated" }
    ]
  };

  const merged = overlayCalculatedStandings(published, calculated);
  assert.equal(merged.standings[0].school_name, "Conway");
  assert.equal(merged.standings[0].rank, 1);
  assert.equal(merged.standings[0].conference_record, "1-0");
  assert.deepEqual(merged.standings.slice(1).map(row => row.rank), [2, 2]);
});

test("record rebuild materializes only the touched football conference cohorts", async () => {
  const writes = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          if (sql.includes("SELECT DISTINCT t.conference_id")) {
            return { results: [
              { conference_id: "7a-central", sport: "football", gender: "boys", season: "2026", standings_method: "published", coverage_complete: 0 },
              { conference_id: "7a-west", sport: "football", gender: "boys", season: "2026", standings_method: "published", coverage_complete: 0 }
            ] };
          }
          if (sql.includes("SELECT t.id AS team_id,s.name AS school_name")) {
            if (this.args[0] === "7a-central") {
              return { results: [
                { team_id: "conway-football-2026", school_name: "Conway", wins: 0, losses: 1, ties: 0, conference_wins: 0, conference_losses: 0, conference_ties: 0 },
                { team_id: "cabot-football-2026", school_name: "Cabot", wins: 0, losses: 0, ties: 0, conference_wins: 0, conference_losses: 0, conference_ties: 0 }
              ] };
            }
            return { results: [
              { team_id: "bentonville-football-2026", school_name: "Bentonville", wins: 1, losses: 0, ties: 0, conference_wins: 0, conference_losses: 0, conference_ties: 0 },
              { team_id: "fayetteville-football-2026", school_name: "Fayetteville", wins: 0, losses: 0, ties: 0, conference_wins: 0, conference_losses: 0, conference_ties: 0 }
            ] };
          }
          throw new Error(`unexpected query: ${sql}`);
        }
      };
      return statement;
    },
    async batch(statements) {
      writes.push(...statements.map(statement => ({ sql: statement.sql, args: statement.args })));
      return statements.map(() => ({ success: true, meta: { rows_written: 1 } }));
    }
  };

  const result = await rebuildStandingsForTeams({ DB: db }, [
    "conway-football-2026",
    "bentonville-football-2026"
  ], "2026-09-05T01:00:00.000Z");

  assert.deepEqual(result, { cohorts: 2, standingsRows: 4 });
  const byTeam = new Map(writes.map(write => [write.args[1], write.args]));
  assert.equal(byTeam.get("conway-football-2026")[4], "0-1");
  assert.equal(byTeam.get("conway-football-2026")[3], "0-0");
  assert.equal(byTeam.get("bentonville-football-2026")[4], "1-0");
  assert.equal(byTeam.get("bentonville-football-2026")[3], "0-0");
});

test("live standings route is not held in the public edge cache", async () => {
  const publicCors = await readFile(new URL("../src/public-cors-worker.js", import.meta.url), "utf8");
  const standingsWorker = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(publicCors, /path === "\/api\/v1\/standings"\s*\|\|/);
  assert.match(publicCors, /path === "\/api\/v1\/standings\/options"/);
  assert.match(standingsWorker, /loadMaterializedCalculatedStandings/);
  assert.match(standingsWorker, /overlayCalculatedStandings/);
  assert.match(standingsWorker, /coverage_complete/);
  assert.match(standingsWorker, /200, "no-store"/);
});
