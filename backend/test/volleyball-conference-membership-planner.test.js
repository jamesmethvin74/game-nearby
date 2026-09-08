import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  planVolleyballConferenceMembershipChanges,
  syncPublishedVolleyballConferenceMembership
} from "../src/volleyball-conference-membership.js";

function d1FromSqlite(db,{onBatch=()=>{}}={}) {
  const prepare=sql=>{let args=[];return {
    bind(...next){args=next;return this;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async first(){return db.prepare(sql).get(...args)||null;},
    async run(){return db.prepare(sql).run(...args);}
  }};
  return {
    prepare,
    async batch(statements){
      onBatch();
      const out=[];
      for(const statement of statements) out.push(await statement.run());
      return out;
    }
  };
}

function schema(db) {
  db.exec(`
    CREATE TABLE schools(id TEXT PRIMARY KEY,name TEXT,level TEXT,catalog_scope TEXT,location_matched_name TEXT);
    CREATE TABLE conferences(id TEXT PRIMARY KEY,name TEXT,classification TEXT,standings_method TEXT,coverage_complete INTEGER,source_url TEXT,updated_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,school_id TEXT,sport TEXT,gender TEXT,season TEXT,conference_id TEXT,active INTEGER,updated_at TEXT);
  `);
}

const sourceUrl="https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/";
const standings=`<table>
<tr><td>1</td><td>Conway</td><td>1-0</td><td>1.000</td><td>5-4</td><td>.556</td></tr>
<tr><td>2</td><td>Little Rock Southwest</td><td>0-1</td><td>.000</td><td>1-3</td><td>.250</td></tr>
<tr><td>3</td><td>Cabot</td><td>0-0</td><td>.000</td><td>2-2</td><td>.500</td></tr>
</table>`;

function seededDb() {
  const db=new DatabaseSync(":memory:");
  schema(db);
  const now="2026-09-08T20:30:00.000Z";
  for(const [id,name,matched] of [
    ["conway","Conway High School","Conway High School"],
    ["southwest","Southwest High School","Little Rock Southwest High School"],
    ["cabot","Cabot High School","Cabot High School"]
  ]) db.prepare("INSERT INTO schools VALUES(?,?,?,?,?)").run(id,name,"high-school","local",matched);
  db.prepare("INSERT INTO teams VALUES(?,?,?,?,?,?,?,?)").run("conway-vb","conway","volleyball","girls","2026","6a-central-volleyball",1,now);
  db.prepare("INSERT INTO teams VALUES(?,?,?,?,?,?,?,?)").run("southwest-vb","southwest","volleyball","girls","2026",null,1,now);
  db.prepare("INSERT INTO teams VALUES(?,?,?,?,?,?,?,?)").run("cabot-vb","cabot","volleyball","girls","2026","5a-central-volleyball",1,now);
  return db;
}

function fetchFn(url) {
  const value=String(url);
  if(value.includes("/conference/6a-central/")) return Promise.resolve(new Response(standings,{status:200}));
  if(value.endsWith("/ar/volleyball/")) return Promise.resolve(new Response(`<a href="${sourceUrl}">6A Central Volleyball Standings</a>`,{status:200}));
  return Promise.resolve(new Response("",{status:404}));
}

test("M6 membership planner separates aligned, missing, and wrong assignments",()=>{
  const localTeams=[
    {team_id:"a",school_id:"sa",school_name:"A",conference_id:"6a-central-volleyball"},
    {team_id:"b",school_id:"sb",school_name:"B",conference_id:null},
    {team_id:"c",school_id:"sc",school_name:"C",conference_id:"5a-central-volleyball"}
  ];
  const assignments=localTeams.map(team=>({team_id:team.team_id,school_id:team.school_id,conference_id:"6a-central-volleyball",conference_name:"6A Central"}));
  const plan=planVolleyballConferenceMembershipChanges({assignments,localTeams});
  assert.equal(plan.assignments,3);
  assert.equal(plan.aligned_count,1);
  assert.equal(plan.missing_count,1);
  assert.equal(plan.wrong_count,1);
  assert.equal(plan.change_count,2);
  assert.deepEqual(plan.changes.map(row=>row.team_id).sort(),["b","c"]);
});

test("M6 dry-run returns exact membership delta and performs no D1 batch write",async()=>{
  const db=seededDb();
  let batches=0;
  const result=await syncPublishedVolleyballConferenceMembership({DB:d1FromSqlite(db,{onBatch:()=>batches++})},{
    fetchFn,
    dryRun:true,
    conferenceIds:["6a-central"],
    conferenceSourceOverrides:{"6a-central":{name:"6A Central",source_url:sourceUrl}},
    maxTeamChanges:2,
    maxConferenceRows:1
  });
  assert.equal(result.status,"DRY_RUN");
  assert.equal(result.plan.aligned_count,1);
  assert.equal(result.plan.missing_count,1);
  assert.equal(result.plan.wrong_count,1);
  assert.equal(result.plan.change_count,2);
  assert.equal(result.d1Statements,0);
  assert.equal(batches,0);
  assert.equal(db.prepare("SELECT conference_id FROM teams WHERE id='southwest-vb'").get().conference_id,null);
  assert.equal(db.prepare("SELECT conference_id FROM teams WHERE id='cabot-vb'").get().conference_id,"5a-central-volleyball");
});

test("M6 team-change fuse aborts before any D1 batch write",async()=>{
  const db=seededDb();
  let batches=0;
  await assert.rejects(
    syncPublishedVolleyballConferenceMembership({DB:d1FromSqlite(db,{onBatch:()=>batches++})},{
      fetchFn,
      conferenceIds:["6a-central"],
      conferenceSourceOverrides:{"6a-central":{name:"6A Central",source_url:sourceUrl}},
      maxTeamChanges:1,
      maxConferenceRows:1
    }),
    /team-change fuse exceeded: planned 2, limit 1/
  );
  assert.equal(batches,0);
});
