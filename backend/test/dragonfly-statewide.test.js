import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { buildStatewideDragonFlyRows, STATEWIDE_SQL } from "../src/dragonfly-statewide.js";

const fixture=fileURLToPath(new URL("./fixtures/dragonfly-greenbrier-vilonia-2026.json",import.meta.url));
const checkedAt="2026-08-31T20:00:00.000Z";

function validationMappings(){
  return [
    {external_team_id:"695c155dbb8c2087231e7e45",source_id:"gb-statewide",source_url:"https://example.test/feed",team_id:"gb-team",school_id:"greenbrier",school_name:"Greenbrier High School",latitude:35.2334,longitude:-92.3870},
    {external_team_id:"698a49819bbf0a84a92470a1",source_id:"vil-statewide",source_url:"https://example.test/feed",team_id:"vil-team",school_id:"vilonia",school_name:"Vilonia High School",latitude:35.0839,longitude:-92.2029}
  ];
}

test("builds reciprocal observations and one canonical event from one DragonFly event",()=>{
  const payload=JSON.parse(fs.readFileSync(fixture,"utf8"));
  const rows=buildStatewideDragonFlyRows(payload,validationMappings(),{checkedAt});
  assert.equal(rows.games.length,2);
  assert.equal(rows.members.length,2);
  assert.equal(rows.canonicals.length,1);
  const canonical=rows.canonicals[0];
  assert.equal(canonical.id,"ce:volleyball:girls:2026:greenbrier:vilonia:20260825:df-69cbc6e2a49cc05727000000");
  assert.equal(canonical.home_school_id,"vilonia");
  assert.equal(canonical.away_school_id,"greenbrier");
  assert.equal(canonical.home_score,0);
  assert.equal(canonical.away_score,3);
  assert.equal(canonical.status,"FINAL");
  assert.equal(canonical.trust_state,"CORROBORATED");
  const gb=rows.games.find(game=>game.team_id==="gb-team");
  assert.equal(gb.home_away,"away");
  assert.equal(gb.team_score,3);
  assert.equal(gb.opponent_score,0);
  assert.equal(gb.result,"W");
});

test("external team ids disambiguate schools with the same display name",()=>{
  const payload={schedule:[{
    eventId:"benton-test",date:"2026-09-01T23:00:00.000Z",associatedSports:[{code:"WVB",level:"Varsity"}],
    participants:[
      {name:"Benton High School",orgShortCode:"BNYTWL",isHome:true,team:{teamId:"benton-a",level:"Varsity"}},
      {name:"Benton High School",orgShortCode:"3APQKQ",isHome:false,team:{teamId:"benton-b",level:"Varsity"}}
    ]
  }]};
  const mappings=[
    {external_team_id:"benton-a",source_id:"source-a",source_url:"x",team_id:"team-a",school_id:"benton-a-school",school_name:"Benton High School"},
    {external_team_id:"benton-b",source_id:"source-b",source_url:"x",team_id:"team-b",school_id:"benton-b-school",school_name:"Benton High School"}
  ];
  const rows=buildStatewideDragonFlyRows(payload,mappings,{checkedAt});
  assert.equal(rows.games.length,2);
  assert.equal(rows.canonicals.length,1);
  assert.equal(rows.canonicals[0].home_school_id,"benton-a-school");
  assert.equal(rows.canonicals[0].away_school_id,"benton-b-school");
  assert.match(rows.canonicals[0].id,/benton-a-school:benton-b-school/);
});

test("bulk JSON SQL upserts execute in SQLite and preserve canonical membership",()=>{
  const db=new DatabaseSync(":memory:");
  const migrations=fileURLToPath(new URL("../migrations/",import.meta.url));
  for (const file of fs.readdirSync(migrations).filter(name=>name.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`${migrations}/${file}`,"utf8"));
  db.exec(`
    INSERT OR IGNORE INTO schools(id,name,city,state,level) VALUES
      ('greenbrier','Greenbrier High School','Greenbrier','AR','high-school'),
      ('vilonia','Vilonia High School','Vilonia','AR','high-school');
    INSERT OR IGNORE INTO teams(id,school_id,sport,gender,season,active) VALUES
      ('gb-team','greenbrier','volleyball','girls','2026',1),
      ('vil-team','vilonia','volleyball','girls','2026',1);
    INSERT OR IGNORE INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode)
      VALUES
      ('gb-statewide','gb-team','https://example.test/feed','official-conference',1,'dragonfly-public','4','America/Chicago',1,180,60,0,10,720,'statewide'),
      ('vil-statewide','vil-team','https://example.test/feed','official-conference',1,'dragonfly-public','4','America/Chicago',1,180,60,0,10,720,'statewide');
  `);
  const payload=JSON.parse(fs.readFileSync(fixture,"utf8"));
  const rows=buildStatewideDragonFlyRows(payload,validationMappings(),{checkedAt});
  db.prepare(STATEWIDE_SQL.upsertCanonical).run(JSON.stringify(rows.canonicals));
  db.prepare(STATEWIDE_SQL.upsertGames).run(JSON.stringify(rows.games));
  db.prepare(STATEWIDE_SQL.upsertMembers).run(JSON.stringify(rows.members));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE id=?").get(rows.canonicals[0].id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM games WHERE canonical_event_id=?").get(rows.canonicals[0].id).n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canonical_event_members WHERE canonical_event_id=?").get(rows.canonicals[0].id).n,2);
  const gb=db.prepare("SELECT status,team_score,opponent_score,result FROM games WHERE team_id='gb-team'").get();
  assert.deepEqual(gb,{status:"FINAL",team_score:3,opponent_score:0,result:"W"});
});
