import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runMaxPrepsVolleyballResultFallback } from "../src/maxpreps-volleyball-result-collector.js";

function d1FromSqlite(db){
  const prepare=sql=>{let args=[];return {
    bind(...next){args=next;return this;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async first(){return db.prepare(sql).get(...args)||null;},
    async run(){return db.prepare(sql).run(...args);}
  }};
  return {prepare,async batch(statements){const out=[];for(const statement of statements) out.push(await statement.run());return out;}};
}

function applyMigrations(db){
  const dir=fileURLToPath(new URL("../migrations/",import.meta.url));
  for(const file of fs.readdirSync(dir).filter(name=>name.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`${dir}/${file}`,"utf8"));
}

function scorePage({date,card}){
  return `<!doctype html><html><body>
    <select id="q_n_teams">
      <option value="b3i3gpABj0eTqJfNrCI3Rw">Bergman</option>
      <option value="rodllMNpDkWVbWyCVle9GA">Flippin</option>
      <option value="zYq0zGR3Fkq0D8MQ9-aC8w">Cotter</option>
    </select>
    <ul>${card}</ul>
    <footer>${date}</footer>
  </body></html>`;
}

const bergmanCard=`<li class="c" data-teams="b3i3gpABj0eTqJfNrCI3Rw,rodllMNpDkWVbWyCVle9GA" data-ri="0" data-contest-id="f5f278ae-d2e1-4016-b349-0e855bd0a838"><div class="contest-box-item" data-contest-state="boxscore"><a href="https://www.maxpreps.com/ar/volleyball/match/bergman-vs-flippin/8-27-2026/?c=f5f278ae-d2e1-4016-b349-0e855bd0a838" class="c-c"><ul class="teams"><li data-result="2" class="winner"><div class="score">3</div><div class="name">Flippin</div></li><li data-result="3"><div class="score">2</div><div class="name">Bergman</div></li></ul><div class="details"> Final</div></a></div></li>`;
const cotterCard=`<li class="c" data-teams="zYq0zGR3Fkq0D8MQ9-aC8w,rodllMNpDkWVbWyCVle9GA" data-ri="0" data-contest-id="8c531348-9e1a-4661-8af5-babfeb264821"><div class="contest-box-item" data-contest-state="boxscore"><a href="https://www.maxpreps.com/ar/volleyball/match/cotter-vs-flippin/8-29-2026/?c=8c531348-9e1a-4661-8af5-babfeb264821" class="c-c"><ul class="teams"><li data-result="3"><div class="score">0</div><div class="name">Flippin</div></li><li data-result="2" class="winner"><div class="score">2</div><div class="name">Cotter</div></li></ul><div class="details"> Final</div></a></div></li>`;

test("secondary statewide score pages repair a stale DragonFly final and create a missing tournament final",async()=>{
  const db=new DatabaseSync(":memory:");
  applyMigrations(db);
  const env={DB:d1FromSqlite(db)};
  const now="2026-09-07T21:00:00.000Z";

  for(const [id,name] of [["test-flippin","Flippin High School"],["test-bergman","Bergman High School"],["test-cotter","Cotter High School"]]) {
    db.prepare(`INSERT INTO schools(id,name,city,state,level,catalog_scope,updated_at) VALUES(?,?,?,'AR','high-school','local',?)`).run(id,name,name,now);
    db.prepare(`INSERT INTO teams(id,school_id,sport,gender,season,active,updated_at) VALUES(?,?,'volleyball','girls','2026',1,?)`).run(`${id}-volleyball-2026`,id,now);
  }

  db.prepare(`INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES('test-flippin-dragonfly','test-flippin-volleyball-2026','https://dragonfly.test','official-conference',1,'dragonfly-public','3','America/Chicago',1,180,60,0,10,720,'statewide',?)`).run(now);

  const canonicalId="ce:volleyball:girls:2026:test-bergman:test-flippin:20260827:df-bergman-event";
  db.prepare(`INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,conference_game,status,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    VALUES(?,'volleyball','girls','2026','test-bergman','test-flippin','test-bergman','test-flippin','2026-08-27T20:30:00.000Z',1,0,'SCHEDULED','test-flippin-dragonfly','AUTHORITATIVE_LIVE',0,'{}',?,?)`).run(canonicalId,now,now);
  db.prepare(`INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,home_away,conference_game,counts_for_record,status,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES('test-flippin-dragonfly:native:bergman-event','test-flippin-volleyball-2026','test-flippin-dragonfly','native:bergman-event','Bergman High School','test-bergman','2026-08-27T20:30:00.000Z',1,'away',0,1,'SCHEDULED','https://dragonfly.test',?,?,?,?)`).run(now,now,now,canonicalId);
  db.prepare(`INSERT INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) VALUES(?,?,?,?,?)`)
    .run(canonicalId,'test-flippin-dragonfly:native:bergman-event','test-flippin-dragonfly','test-flippin-volleyball-2026',now);

  const fetchFn=async url=>{
    const text=String(url);
    const html=text.includes('8%2F27%2F2026')
      ? scorePage({date:'2026-08-27',card:bergmanCard})
      : text.includes('8%2F29%2F2026')
        ? scorePage({date:'2026-08-29',card:cotterCard})
        : '';
    return new Response(html,{status:html?200:404,headers:{'content-type':'text/html'}});
  };

  const result=await runMaxPrepsVolleyballResultFallback(env,{
    dates:["2026-08-27","2026-08-29"],fetchFn,now:new Date(now)
  });
  assert.equal(result.status,"SUCCESS");
  assert.equal(result.pagesFetched,2);
  assert.equal(result.matchedFinals,2);
  assert.equal(result.touchedTeams,3);

  const bergman=db.prepare(`SELECT * FROM canonical_events WHERE participant_a_school_id='test-bergman' AND participant_b_school_id='test-flippin' AND status='FINAL'`).get();
  assert.ok(bergman);
  assert.equal(bergman.home_school_id,"test-bergman");
  assert.equal(bergman.away_school_id,"test-flippin");
  assert.equal(bergman.home_score,2);
  assert.equal(bergman.away_score,3);
  assert.equal(bergman.selected_source_id,"test-flippin-dragonfly");

  const cotter=db.prepare(`SELECT * FROM canonical_events WHERE participant_a_school_id='test-cotter' AND participant_b_school_id='test-flippin' AND status='FINAL'`).get();
  assert.ok(cotter);
  assert.equal(cotter.home_school_id,"test-cotter");
  assert.equal(cotter.away_school_id,"test-flippin");
  assert.equal(cotter.home_score,2);
  assert.equal(cotter.away_score,0);
  assert.match(String(cotter.selected_source_id),/^maxpreps-volleyball-results:/);

  const flippin=db.prepare("SELECT * FROM team_records WHERE team_id='test-flippin-volleyball-2026'").get();
  assert.ok(flippin);
  assert.equal(flippin.wins,1);
  assert.equal(flippin.losses,1);
  assert.equal(flippin.ties,0);

  const fallbackSources=db.prepare("SELECT id,source_type,parser_type,authority_rank,enabled FROM sources WHERE id LIKE 'maxpreps-volleyball-results:%' ORDER BY id").all();
  assert.equal(fallbackSources.length,3);
  assert.ok(fallbackSources.every(row=>row.source_type==='secondary'&&row.parser_type==='maxpreps-scores'&&row.authority_rank===80&&row.enabled===0));

  const second=await runMaxPrepsVolleyballResultFallback(env,{
    dates:["2026-08-27","2026-08-29"],fetchFn,now:new Date("2026-09-07T21:05:00.000Z")
  });
  assert.equal(second.status,"NOT_MODIFIED");
  assert.equal(second.matchedFinals,0);
  assert.equal(second.touchedTeams,0);
  assert.equal(second.writes,0);
});
