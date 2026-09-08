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

function page({contestId,localDate,localScore,opponentScore}) {
  return `<!doctype html><html><body>
    <select id="q_n_teams">
      <option value="rodllMNpDkWVbWyCVle9GA">Flippin</option>
      <option value="mo-academy-id">Missouri Academy</option>
    </select>
    <ul>
      <li class="c" data-teams="rodllMNpDkWVbWyCVle9GA,mo-academy-id" data-contest-id="${contestId}">
        <div class="contest-box-item" data-contest-state="boxscore">
          <a href="https://www.maxpreps.com/ar/volleyball/match/flippin-vs-missouri-academy/${localDate}/?c=${contestId}" class="c-c">
            <ul class="teams">
              <li class="winner"><div class="score">${localScore}</div><div class="name">Flippin</div></li>
              <li><div class="score">${opponentScore}</div><div class="name">Missouri Academy</div></li>
            </ul>
            <div class="details"> Final</div>
          </a>
        </div>
      </li>
    </ul>
  </body></html>`;
}

test("one-sided MaxPreps finals create one hidden opponent identity, reuse it, and rebuild only the local team",async()=>{
  const db=new DatabaseSync(":memory:");
  applyMigrations(db);
  const env={DB:d1FromSqlite(db)};
  const now="2026-09-07T21:00:00.000Z";

  db.prepare(`INSERT INTO schools(id,name,city,state,level,catalog_scope,updated_at)
    VALUES('test-flippin','Flippin High School','Flippin','AR','high-school','local',?)`).run(now);
  db.prepare(`INSERT INTO teams(id,school_id,sport,gender,season,active,updated_at)
    VALUES('test-flippin-volleyball-2026','test-flippin','volleyball','girls','2026',1,?)`).run(now);

  const fetchFn=async url=>{
    const text=String(url);
    if(text.includes('8%2F30%2F2026')) return new Response(page({contestId:'one-sided-a',localDate:'8-30-2026',localScore:3,opponentScore:1}),{status:200});
    if(text.includes('8%2F31%2F2026')) return new Response(page({contestId:'one-sided-b',localDate:'8-31-2026',localScore:3,opponentScore:0}),{status:200});
    return new Response('',{status:404});
  };

  const result=await runMaxPrepsVolleyballResultFallback(env,{
    dates:["2026-08-30","2026-08-31"],
    targetTeamIds:["test-flippin-volleyball-2026"],
    fetchFn,
    now:new Date(now)
  });

  assert.equal(result.status,"SUCCESS");
  assert.equal(result.matchedFinals,2);
  assert.equal(result.oneSidedMatches,2);
  assert.equal(result.ambiguousMatches,0);
  assert.equal(result.touchedTeams,1);
  assert.equal(result.observations,2);
  assert.equal(result.opponentSchoolsMaterialized,1);
  assert.equal(result.opponentIdentitiesLinked,1);

  const opponent=db.prepare(`SELECT * FROM schools WHERE membership_source='maxpreps-result-opponent'`).get();
  assert.ok(opponent);
  assert.equal(opponent.name,"Missouri Academy");
  assert.equal(opponent.catalog_scope,"opponent-only");
  assert.equal(opponent.state,"");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM teams WHERE school_id=?`).get(opponent.id).n,0);

  const identity=db.prepare(`SELECT * FROM school_external_identities WHERE provider='maxpreps' AND external_school_id='mo-academy-id'`).get();
  assert.ok(identity);
  assert.equal(identity.school_id,opponent.id);

  const events=db.prepare(`SELECT * FROM canonical_events WHERE sport='volleyball' AND season='2026' ORDER BY scheduled_at`).all();
  assert.equal(events.length,2);
  assert.ok(events.every(event=>event.status==='FINAL'));
  assert.ok(events.every(event=>event.home_school_id==='test-flippin'));
  assert.ok(events.every(event=>event.away_school_id===opponent.id));
  assert.deepEqual(events.map(event=>[event.home_score,event.away_score]),[[3,1],[3,0]]);

  const record=db.prepare(`SELECT * FROM team_records WHERE team_id='test-flippin-volleyball-2026'`).get();
  assert.ok(record);
  assert.equal(record.wins,2);
  assert.equal(record.losses,0);

  const second=await runMaxPrepsVolleyballResultFallback(env,{
    dates:["2026-08-30","2026-08-31"],
    targetTeamIds:["test-flippin-volleyball-2026"],
    fetchFn,
    now:new Date("2026-09-07T21:05:00.000Z")
  });
  assert.equal(second.status,"NOT_MODIFIED");
  assert.equal(second.matchedFinals,0);
  assert.equal(second.touchedTeams,0);
  assert.equal(second.writes,0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM schools WHERE membership_source='maxpreps-result-opponent'`).get().n,1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM school_external_identities WHERE provider='maxpreps' AND external_school_id='mo-academy-id'`).get().n,1);
});
