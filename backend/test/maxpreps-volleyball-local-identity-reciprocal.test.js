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

function page(){
  return `<!doctype html><html><body>
    <select id="q_n_teams">
      <option value="flippin-maxpreps-id">Flippin</option>
      <option value="harrison-maxpreps-id">North Arkansas Visitors</option>
    </select>
    <ul>
      <li class="c" data-teams="flippin-maxpreps-id,harrison-maxpreps-id" data-contest-id="local-identity-final">
        <div class="contest-box-item" data-contest-state="boxscore">
          <a href="https://www.maxpreps.com/ar/volleyball/match/flippin-vs-north-arkansas-visitors/8-24-2026/?c=local-identity-final" class="c-c">
            <ul class="teams">
              <li class="winner"><div class="score">3</div><div class="name">Flippin</div></li>
              <li><div class="score">1</div><div class="name">North Arkansas Visitors</div></li>
            </ul>
            <div class="details"> Final</div>
          </a>
        </div>
      </li>
    </ul>
  </body></html>`;
}

test("persisted MaxPreps identity for another local volleyball school writes reciprocal observations",async()=>{
  const db=new DatabaseSync(":memory:");
  applyMigrations(db);
  const env={DB:d1FromSqlite(db)};
  const now="2026-09-11T21:30:00.000Z";

  for(const [schoolId,schoolName,teamId] of [
    ["test-flippin","Flippin High School","test-flippin-volleyball-2026"],
    ["test-harrison","Harrison High School","test-harrison-volleyball-2026"]
  ]) {
    db.prepare(`INSERT INTO schools(id,name,city,state,level,catalog_scope,updated_at)
      VALUES(?,?,?,'AR','high-school','local',?)`).run(schoolId,schoolName,schoolName,now);
    db.prepare(`INSERT INTO teams(id,school_id,sport,gender,season,active,updated_at)
      VALUES(?,?,'volleyball','girls','2026',1,?)`).run(teamId,schoolId,now);
  }

  db.prepare(`INSERT INTO school_external_identities
    (provider,external_school_id,school_id,observed_name,last_seen_at,updated_at)
    VALUES('maxpreps','harrison-maxpreps-id','test-harrison','North Arkansas Visitors',?,?)`).run(now,now);

  const result=await runMaxPrepsVolleyballResultFallback(env,{
    dates:["2026-08-24"],
    targetTeamIds:["test-flippin-volleyball-2026"],
    fetchFn:async()=>new Response(page(),{status:200,headers:{"content-type":"text/html"}}),
    now:new Date(now)
  });

  assert.equal(result.status,"SUCCESS");
  assert.equal(result.oneSidedMatches,1);
  assert.equal(result.matchedFinals,1);
  assert.equal(result.observations,2);
  assert.equal(result.touchedTeams,2);
  assert.equal(result.opponentSchoolsMaterialized,0);

  const event=db.prepare(`SELECT * FROM canonical_events
    WHERE sport='volleyball' AND gender='girls' AND season='2026' AND status='FINAL'`).get();
  assert.ok(event);
  assert.deepEqual(new Set([event.participant_a_school_id,event.participant_b_school_id]),new Set(["test-flippin","test-harrison"]));

  const members=db.prepare(`SELECT reporting_team_id FROM canonical_event_members
    WHERE canonical_event_id=? ORDER BY reporting_team_id`).all(event.id);
  assert.deepEqual(members.map(row=>row.reporting_team_id),[
    "test-flippin-volleyball-2026",
    "test-harrison-volleyball-2026"
  ]);

  const games=db.prepare(`SELECT team_id,opponent_school_id,status,team_score,opponent_score
    FROM games WHERE canonical_event_id=? ORDER BY team_id`).all(event.id);
  assert.equal(games.length,2);
  assert.deepEqual(games.map(row=>row.team_id),[
    "test-flippin-volleyball-2026",
    "test-harrison-volleyball-2026"
  ]);
  assert.ok(games.every(row=>row.status==="FINAL"));
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM schools WHERE membership_source='maxpreps-result-opponent'`).get().n,0);
});
