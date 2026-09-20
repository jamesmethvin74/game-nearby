import test from "node:test";
import assert from "node:assert/strict";
import { auditPresentationRows, classifyStatewideIntegritySurfaces } from "../src/statewide-data-integrity-audit.js";

const NOW = new Date("2026-09-16T23:30:00.000Z");

function row(overrides = {}) {
  return {
    team_id: "bryant-football-2026",
    school_id: "bryant",
    school_name: "Bryant High School",
    level: "high-school",
    sport: "football",
    gender: "boys",
    season: "2026",
    game_id: "game-a",
    source_id: "bryant-football-school",
    source_type: "official-school",
    parser_type: "mascot-media",
    opponent: "Benton High School",
    opponent_school_id: "benton",
    raw_scheduled_at: "2026-08-29T00:00:00.000Z",
    raw_time_known: 1,
    raw_status: "SCHEDULED",
    raw_team_score: null,
    raw_opponent_score: null,
    raw_result: null,
    counts_for_record: 1,
    home_away: "home",
    canonical_event_id: "ce-a",
    canonical_scheduled_at: "2026-08-29T00:00:00.000Z",
    canonical_time_known: 1,
    canonical_status: "SCHEDULED",
    canonical_home_score: null,
    canonical_away_score: null,
    canonical_home_school_id: "bryant",
    canonical_away_school_id: "benton",
    canonical_trust_state: "SINGLE_SOURCE_LIVE",
    ...overrides
  };
}

function codes(audit) {
  return audit.issues.map(value => value.code);
}

test("Bryant-shaped stale scheduled observation beside a verified Benton final is blocking", () => {
  const audit = auditPresentationRows([
    row(),
    row({
      game_id: "game-b",
      source_id: "bryant-football-results",
      source_type: "secondary",
      parser_type: "hootens",
      canonical_event_id: "ce-b",
      raw_status: "FINAL",
      raw_team_score: 42,
      raw_opponent_score: 43,
      raw_result: "L",
      canonical_status: "FINAL",
      canonical_home_score: 42,
      canonical_away_score: 43,
      canonical_trust_state: "AUTHORITATIVE_LIVE"
    })
  ], { now: NOW });

  assert.equal(audit.clean, false);
  assert.ok(codes(audit).includes("SPLIT_CANONICAL_LOGICAL_GAME"));
  assert.ok(codes(audit).includes("STALE_NONTERMINAL_TWIN_OF_FINAL"));
  assert.equal(audit.summary.total_active_teams_examined, 1);
  assert.equal(audit.summary.total_schedule_rows_examined, 2);
});

test("Alexandria Senior High School and Alexandria (LA) reconcile as one logical timed game", () => {
  const audit = auditPresentationRows([
    row({
      game_id: "alex-a",
      opponent: "Alexandria Senior High School",
      opponent_school_id: null,
      raw_scheduled_at: "2026-09-05T00:00:00.000Z",
      canonical_scheduled_at: "2026-09-05T00:00:00.000Z",
      canonical_event_id: "ce-alex-a",
      canonical_away_school_id: null
    }),
    row({
      game_id: "alex-b",
      opponent: "Alexandria (LA)",
      opponent_school_id: null,
      raw_scheduled_at: "2026-09-05T00:00:00.000Z",
      canonical_scheduled_at: "2026-09-05T00:00:00.000Z",
      canonical_event_id: "ce-alex-b",
      canonical_away_school_id: null,
      raw_status: "FINAL",
      raw_team_score: 20,
      raw_opponent_score: 44,
      raw_result: "L",
      canonical_status: "FINAL",
      canonical_home_score: null,
      canonical_away_score: null
    })
  ], { now: NOW });

  assert.ok(codes(audit).includes("SPLIT_CANONICAL_LOGICAL_GAME"));
  assert.ok(codes(audit).includes("STALE_NONTERMINAL_TWIN_OF_FINAL"));
});

test("duplicate future Little Rock Central schedule rows are caught before a result exists", () => {
  const audit = auditPresentationRows([
    row({
      game_id: "central-a",
      opponent: "Little Rock Central High School",
      opponent_school_id: "little-rock-central",
      raw_scheduled_at: "2026-09-26T00:00:00.000Z",
      canonical_scheduled_at: "2026-09-26T00:00:00.000Z",
      canonical_event_id: "ce-central-a",
      canonical_away_school_id: "little-rock-central"
    }),
    row({
      game_id: "central-b",
      opponent: "Central",
      opponent_school_id: "little-rock-central",
      raw_scheduled_at: "2026-09-26T00:00:00.000Z",
      canonical_scheduled_at: "2026-09-26T00:00:00.000Z",
      canonical_event_id: "ce-central-b",
      canonical_away_school_id: "little-rock-central",
      source_id: "bryant-football-secondary"
    })
  ], { now: NOW });

  assert.ok(codes(audit).includes("SPLIT_CANONICAL_LOGICAL_GAME"));
  assert.ok(codes(audit).includes("DUPLICATE_SCHEDULE_ENTRY"));
});

test("date-only distinct canonical rows remain separate to protect possible rematches", () => {
  const audit = auditPresentationRows([
    row({
      game_id: "tourney-a",
      opponent: "Cabot High School",
      opponent_school_id: "cabot",
      raw_scheduled_at: "2026-10-10T05:00:00.000Z",
      canonical_scheduled_at: "2026-10-10T05:00:00.000Z",
      raw_time_known: 0,
      canonical_time_known: 0,
      canonical_event_id: "ce-tourney-a",
      canonical_away_school_id: "cabot"
    }),
    row({
      game_id: "tourney-b",
      opponent: "Cabot High School",
      opponent_school_id: "cabot",
      raw_scheduled_at: "2026-10-10T05:00:00.000Z",
      canonical_scheduled_at: "2026-10-10T05:00:00.000Z",
      raw_time_known: 0,
      canonical_time_known: 0,
      canonical_event_id: "ce-tourney-b",
      canonical_away_school_id: "cabot"
    })
  ], { now: NOW });

  assert.equal(codes(audit).includes("SPLIT_CANONICAL_LOGICAL_GAME"), false);
  assert.equal(codes(audit).includes("DUPLICATE_SCHEDULE_ENTRY"), false);
});

test("an app-visible FINAL missing scores is caught even when it does not count for record", () => {
  const audit = auditPresentationRows([
    row({
      game_id: "nonrecord-final",
      opponent: "Opponent High School",
      canonical_event_id: "ce-nonrecord",
      raw_status: "FINAL",
      canonical_status: "FINAL",
      counts_for_record: 0,
      raw_team_score: null,
      raw_opponent_score: null,
      canonical_home_score: null,
      canonical_away_score: null
    })
  ], { now: NOW });

  assert.ok(codes(audit).includes("DISPLAY_FINAL_MISSING_SCORE"));
  assert.equal(audit.clean, false);
});

test("audit scope includes every active team/sport supplied, not one volleyball team per school", () => {
  const audit = auditPresentationRows([
    row({ team_id: "bryant-football-2026", sport: "football", game_id: null }),
    row({ team_id: "bryant-volleyball-2026", sport: "volleyball", gender: "girls", game_id: null }),
    row({ team_id: "bryant-boys-basketball-2026", sport: "basketball", gender: "boys", game_id: null }),
    row({ team_id: "uca-soccer-2026", school_id: "uca", school_name: "University of Central Arkansas", level: "college", sport: "soccer", gender: "women", game_id: null })
  ], { now: NOW });

  assert.equal(audit.summary.total_active_teams_examined, 4);
  assert.deepEqual(audit.summary.sports_examined, ["basketball", "football", "soccer", "volleyball"]);
  assert.deepEqual(audit.summary.levels_examined, ["college", "high-school"]);
});


test("football same-day collision is blocking even when opponent identities disagree",()=>{
  const audit=auditPresentationRows([
    row({
      team_id:"north-little-rock-football-2026",
      school_id:"north-little-rock",
      school_name:"North Little Rock High School",
      game_id:"nlr-robinson-full",
      opponent:"Joe T. Robinson High School",
      opponent_school_id:"joe-t-robinson",
      raw_scheduled_at:"2026-09-05T00:00:00.000Z",
      canonical_scheduled_at:"2026-09-05T00:00:00.000Z",
      canonical_event_id:"ce-robinson-full",
      canonical_away_school_id:"joe-t-robinson",
      source_type:"official-school",
      parser_type:"mascot-media"
    }),
    row({
      team_id:"north-little-rock-football-2026",
      school_id:"north-little-rock",
      school_name:"North Little Rock High School",
      game_id:"nlr-robinson-short",
      opponent:"Robinson",
      opponent_school_id:"robinson-legacy",
      raw_scheduled_at:"2026-09-05T00:00:00.000Z",
      canonical_scheduled_at:"2026-09-05T00:00:00.000Z",
      canonical_event_id:"ce-robinson-short",
      canonical_away_school_id:"robinson-legacy",
      source_type:"secondary",
      parser_type:"legacy"
    })
  ],{now:new Date("2026-09-04T12:00:00.000Z")});

  const collision=audit.issues.find(value=>value.code==="FOOTBALL_SAME_DAY_COLLISION");
  assert.ok(collision);
  assert.equal(collision.game_id,"nlr-robinson-short");
  assert.equal(collision.other_game_id,"nlr-robinson-full");
  assert.equal(collision.severity,"blocking");
  assert.equal(codes(audit).includes("SPLIT_CANONICAL_LOGICAL_GAME"),false,
    "different opponent identities must not be canonical-merged merely because football shares a date");
});


test("same-day regular-season volleyball final suppresses stale source twin across time drift",()=>{
  const audit=auditPresentationRows([
    row({
      team_id:"north-little-rock-volleyball-2026",
      school_id:"north-little-rock",
      school_name:"North Little Rock High School",
      sport:"volleyball",
      gender:"girls",
      game_id:"pa-final",
      opponent:"Pulaski Academy High School",
      opponent_school_id:"pulaski-academy",
      raw_scheduled_at:"2026-09-01T22:30:00.000Z",
      canonical_scheduled_at:"2026-09-01T22:30:00.000Z",
      canonical_event_id:"ce-pa-final",
      raw_status:"FINAL",
      raw_team_score:0,
      raw_opponent_score:1,
      canonical_status:"FINAL",
      canonical_home_score:0,
      canonical_away_score:1,
      canonical_home_school_id:"north-little-rock",
      canonical_away_school_id:"pulaski-academy"
    }),
    row({
      team_id:"north-little-rock-volleyball-2026",
      school_id:"north-little-rock",
      school_name:"North Little Rock High School",
      sport:"volleyball",
      gender:"girls",
      game_id:"pa-stale",
      opponent:"Pulaski Academy",
      opponent_school_id:"pulaski-academy-legacy",
      raw_scheduled_at:"2026-09-01T23:30:00.000Z",
      canonical_scheduled_at:"2026-09-01T23:30:00.000Z",
      canonical_event_id:"ce-pa-stale",
      raw_status:"SCHEDULED",
      canonical_status:"SCHEDULED",
      canonical_home_school_id:"north-little-rock",
      canonical_away_school_id:"pulaski-academy-legacy"
    })
  ],{now:new Date("2026-09-02T12:00:00.000Z")});
  const stale=audit.issues.find(value=>value.code==="SAME_DAY_STALE_TWIN_OF_FINAL");
  assert.ok(stale);
  assert.equal(stale.game_id,"pa-stale");
  assert.equal(stale.other_game_id,"pa-final");
  assert.equal(stale.severity,"blocking");
  assert.equal(codes(audit).includes("SPLIT_CANONICAL_LOGICAL_GAME"),false);
});


test("pre-official and benefit contests are not part of the audited app-visible schedule surface",()=>{
  const audit=auditPresentationRows([
    row({
      team_id:"north-little-rock-football-2026",
      school_id:"north-little-rock",
      school_name:"North Little Rock High School",
      level:"high-school",
      sport:"football",
      gender:"boys",
      season:"2026",
      game_id:"benefit-football",
      opponent:"Joe T. Robinson High School",
      raw_scheduled_at:"2026-08-22T00:00:00.000Z",
      canonical_scheduled_at:"2026-08-22T00:00:00.000Z",
      status:"SCHEDULED",
      counts_for_record:1,
      parser_type:"dragonfly-public"
    }),
    row({
      team_id:"van-buren-volleyball-2026",
      school_id:"van-buren",
      school_name:"Van Buren High School",
      level:"high-school",
      sport:"volleyball",
      gender:"girls",
      season:"2026",
      game_id:"benefit-volleyball",
      opponent:"Mena High School",
      raw_scheduled_at:"2026-08-20T22:30:00.000Z",
      canonical_scheduled_at:"2026-08-20T22:30:00.000Z",
      status:"SCHEDULED",
      notes:"Benefit Game",
      counts_for_record:1,
      parser_type:"dragonfly-public"
    })
  ],{now:new Date("2026-09-18T12:00:00.000Z")});

  assert.equal(audit.summary.blocking_issues,0);
  assert.equal(audit.summary.warning_issues,0);
  assert.equal(audit.summary.total_schedule_rows_examined,0);
  assert.equal(audit.summary.total_normalized_schedule_rows,0);
});


test("upstream source observation defects remain visible telemetry without failing clean presentation truth",()=>{
  const sourceSurface={issues:[{code:"STALE_NONTERMINAL_TWIN_OF_FINAL",severity:"blocking",team_id:"team-a"}]};
  const truthSurface={issues:[]};
  const sourceVsTruth={issues:[]};
  const classified=classifyStatewideIntegritySurfaces(sourceSurface,truthSurface,sourceVsTruth);
  assert.equal(classified.sourceObservationIssues.length,1);
  assert.equal(classified.sourceObservationIssues[0].surface,"source-observation");
  assert.equal(classified.blockingIssues.length,0);
});

test("ONE_TRUTH and source-vs-truth defects remain production blocking",()=>{
  const sourceSurface={issues:[]};
  const truthSurface={issues:[{code:"DISPLAY_FINAL_MISSING_SCORE",severity:"blocking",team_id:"team-a"}]};
  const sourceVsTruth={issues:[{code:"SOURCE_FINAL_COUNT_VS_ONE_TRUTH",severity:"blocking",team_id:"team-b"}]};
  const classified=classifyStatewideIntegritySurfaces(sourceSurface,truthSurface,sourceVsTruth);
  assert.equal(classified.blockingIssues.length,2);
});
