import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import worker from "../src/worker.js";

function d1FromSqlite(db){
  const prepare=sql=>{
    let args=[];
    return {
      bind(...next){args=next;return this;},
      async all(){return {results:db.prepare(sql).all(...args)};},
      async first(){return db.prepare(sql).get(...args)||null;},
      async run(){return db.prepare(sql).run(...args);}
    };
  };
  return {
    prepare,
    async batch(statements){const results=[];for(const statement of statements) results.push(await statement.run());return results;}
  };
}

function applyMigrations(db){
  const migrations=fileURLToPath(new URL("../migrations/",import.meta.url));
  for (const file of fs.readdirSync(migrations).filter(name=>name.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`${migrations}/${file}`,"utf8"));
}

function seedScopedEvent(db,{prefix,homeName,awayName,latitude,longitude,scope="local",active=1}){
  const now="2026-08-31T20:00:00.000Z";
  const home=`${prefix}-home`,away=`${prefix}-away`;
  const homeTeam=`${home}-volleyball-2026`,awayTeam=`${away}-volleyball-2026`;
  const homeSource=`${homeTeam}-dragonfly`,awaySource=`${awayTeam}-dragonfly`;
  const canonical=`ce:volleyball:girls:2026:${away}:${home}:20260910:df-${prefix}`;
  const scheduled="2026-09-10T23:00:00.000Z";
  const schoolInsert=db.prepare(`INSERT INTO schools(id,name,city,state,level,latitude,longitude,catalog_scope,membership_source,membership_verified_at,updated_at)
    VALUES(?,?,?,'AR','high-school',?,?,?,'arkansas-gis',?,?)`);
  schoolInsert.run(home,homeName,homeName.replace(/ High School$/,""),latitude,longitude,scope,now,now);
  schoolInsert.run(away,awayName,awayName.replace(/ High School$/,""),latitude+0.2,longitude+0.2,scope,now,now);
  const teamInsert=db.prepare(`INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at) VALUES(?,?,'volleyball','girls','2026',NULL,?,?)`);
  teamInsert.run(homeTeam,home,active,now); teamInsert.run(awayTeam,away,active,now);
  const sourceInsert=db.prepare(`INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES(?,?,'https://example.test/dragonfly','official-conference',1,'dragonfly-public','4','America/Chicago',1,180,60,0,10,720,'statewide',?)`);
  sourceInsert.run(homeSource,homeTeam,now); sourceInsert.run(awaySource,awayTeam,now);
  db.prepare(`INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    VALUES(?,'volleyball','girls','2026',?,?,?,?,?,1,?,?,?, ?,0,'SCHEDULED',?,'CORROBORATED',0,'{}',?,?)`)
    .run(canonical,[home,away].sort()[0],[home,away].sort()[1],home,away,scheduled,homeName,homeName,latitude,longitude,homeSource,now,now);
  const gameInsert=db.prepare(`INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,source_url,last_checked_at,updated_at,canonical_event_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,'SCHEDULED','https://example.test/dragonfly',?,?,?)`);
  gameInsert.run(`${homeSource}:native:${prefix}`,homeTeam,homeSource,`native:${prefix}`,awayName,away,scheduled,1,homeName,homeName,latitude,longitude,"home",now,now,canonical);
  gameInsert.run(`${awaySource}:native:${prefix}`,awayTeam,awaySource,`native:${prefix}`,homeName,home,scheduled,1,homeName,homeName,latitude,longitude,"away",now,now,canonical);
  return {canonical,homeTeam,home};
}

test("actual /games nearby route returns a non-pilot local event and hides opponent-only identities",async()=>{
  const db=new DatabaseSync(":memory:");
  applyMigrations(db);
  const local=seedScopedEvent(db,{prefix:"fayetteville-proof",homeName:"Fayetteville High School",awayName:"Springdale High School",latitude:36.0626,longitude:-94.1574});
  seedScopedEvent(db,{prefix:"external-proof",homeName:"External Tournament High School",awayName:"External Opponent High School",latitude:36.0626,longitude:-94.1574,scope:"opponent-only",active:0});
  const env={DB:d1FromSqlite(db)};
  const request=new Request("https://local.test/api/v1/games?lat=36.0626&lon=-94.1574&radius=2&since=2026-09-10T00:00:00.000Z&until=2026-09-11T23:59:59.000Z");
  const response=await worker.fetch(request,env,{});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.games.length,1);
  assert.equal(body.games[0].canonical_event_id,local.canonical);
  assert.equal(body.games[0].school_id,local.home);
  assert.ok(body.games[0].distance_miles<0.01);
  assert.notEqual(body.games[0].school_id,"conway");
  assert.notEqual(body.games[0].school_id,"greenbrier");
  assert.notEqual(body.games[0].school_id,"vilonia");
});

test("public school and team routes enforce catalog scope",async()=>{
  const db=new DatabaseSync(":memory:");
  applyMigrations(db);
  const local=seedScopedEvent(db,{prefix:"local-catalog",homeName:"Fayetteville High School",awayName:"Springdale High School",latitude:36.0626,longitude:-94.1574});
  const hidden=seedScopedEvent(db,{prefix:"hidden-catalog",homeName:"External High School",awayName:"External Two High School",latitude:36.0,longitude:-94.0,scope:"opponent-only",active:0});
  const env={DB:d1FromSqlite(db)};

  const schoolsResponse=await worker.fetch(new Request("https://local.test/api/v1/schools"),env,{});
  const schools=await schoolsResponse.json();
  assert.ok(schools.schools.some(school=>school.id===local.home));
  assert.ok(!schools.schools.some(school=>school.id===hidden.home));

  const hiddenTeamResponse=await worker.fetch(new Request(`https://local.test/api/v1/teams/${hidden.homeTeam}`),env,{});
  assert.equal(hiddenTeamResponse.status,404);
});
