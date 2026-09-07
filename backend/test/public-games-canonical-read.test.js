import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import worker from "../src/m4-public-worker.js";

function d1FromSqlite(db) {
  const prepare = sql => {
    let args=[];
    return {
      bind(...next) { args=next; return this; },
      async all() { return { results:db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { return db.prepare(sql).run(...args); }
    };
  };
  return {
    prepare,
    async batch(statements) {
      const results=[];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
}

function applyMigrations(db) {
  const migrations=fileURLToPath(new URL("../migrations/",import.meta.url));
  for (const file of fs.readdirSync(migrations).filter(name=>name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(`${migrations}/${file}`,"utf8"));
  }
}

function seedEvent(db) {
  const now="2026-09-03T23:30:00.000Z";
  const scheduled="2026-09-03T23:00:00.000Z";
  const home="conway-proof", away="southwest-proof";
  const homeTeam=`${home}-volleyball-2026`, awayTeam=`${away}-volleyball-2026`;
  const homeSource=`${homeTeam}-dragonfly`, awaySource=`${awayTeam}-dragonfly`;
  const canonical=`ce:volleyball:girls:2026:${home}:${away}:20260903:df-proof`;

  const schoolInsert=db.prepare(`INSERT INTO schools(
    id,name,city,state,level,latitude,longitude,catalog_scope,membership_source,membership_verified_at,updated_at
  ) VALUES(?,?,?,'AR','high-school',?,?,'local','arkansas-gis',?,?)`);
  schoolInsert.run(home,"Conway Proof High School","Conway",35.088,-92.442,now,now);
  schoolInsert.run(away,"Southwest Proof High School","Little Rock",34.68,-92.38,now,now);

  const teamInsert=db.prepare(`INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
    VALUES(?,?,'volleyball','girls','2026',NULL,1,?)`);
  teamInsert.run(homeTeam,home,now);
  teamInsert.run(awayTeam,away,now);

  const sourceInsert=db.prepare(`INSERT INTO sources(
    id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,
    expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,
    stale_after_minutes,collection_mode,updated_at
  ) VALUES(?,?,'https://example.test/dragonfly','official-conference',1,'dragonfly-public','4',
    'America/Chicago',1,180,60,1,10,720,'statewide',?)`);
  sourceInsert.run(homeSource,homeTeam,now);
  sourceInsert.run(awaySource,awayTeam,now);

  db.prepare(`INSERT INTO canonical_events(
    id,sport,gender,season,participant_a_school_id,participant_b_school_id,
    home_school_id,away_school_id,scheduled_at,scheduled_time_known,venue,location_text,
    latitude,longitude,conference_game,status,home_score,away_score,selected_source_id,
    trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at
  ) VALUES(?,'volleyball','girls','2026',?,?,?,?,?,1,?,?,?,?,1,'FINAL',3,0,?,
    'CORROBORATED',0,'{}',?,?)`)
    .run(canonical,home,away,home,away,scheduled,"Buzz Bolding Arena","Conway, AR",35.088,-92.442,homeSource,now,now);

  const gameInsert=db.prepare(`INSERT INTO games(
    id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,
    scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,
    counts_for_record,status,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,'SCHEDULED','https://example.test/dragonfly',?,?,?,?)`);
  gameInsert.run(`${homeSource}:native:proof`,homeTeam,homeSource,"native:proof","Southwest Proof High School",away,scheduled,1,"Buzz Bolding Arena","Conway, AR",35.088,-92.442,"home",now,now,now,canonical);
  gameInsert.run(`${awaySource}:native:proof`,awayTeam,awaySource,"native:proof","Conway Proof High School",home,scheduled,1,"Buzz Bolding Arena","Conway, AR",35.088,-92.442,"away",now,now,now,canonical);
  return canonical;
}

test("production public games route resolves canonical FINAL over stale raw schedule rows", async () => {
  const db=new DatabaseSync(":memory:");
  applyMigrations(db);
  const canonical=seedEvent(db);
  const env={DB:d1FromSqlite(db)};
  const request=new Request("https://local.test/api/v1/games?since=2026-09-03T00:00:00.000Z&until=2026-09-04T23:59:59.000Z");
  const response=await worker.fetch(request,env,{});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.games.length,1);
  const game=body.games[0];
  assert.equal(game.canonical_event_id,canonical);
  assert.equal(game.status,"FINAL");
  assert.equal(Number(game.conference_game),1);
  assert.deepEqual(new Set([Number(game.team_score),Number(game.opponent_score)]),new Set([3,0]));
  assert.ok(["W","L"].includes(game.result));
  assert.equal(game.data_trust,"CORROBORATED");
});
