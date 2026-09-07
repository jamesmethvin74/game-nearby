import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  buildVolleyballConferenceMembership,
  syncPublishedVolleyballConferenceMembership
} from "../src/volleyball-conference-membership.js";

function d1FromSqlite(db){
  const prepare=sql=>{let args=[];return {
    bind(...next){args=next;return this;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async first(){return db.prepare(sql).get(...args)||null;},
    async run(){return db.prepare(sql).run(...args);}
  }};
  return {prepare,async batch(statements){const out=[];for(const statement of statements) out.push(await statement.run());return out;}};
}

function schema(db){
  db.exec(`
    CREATE TABLE schools(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      level TEXT NOT NULL,
      catalog_scope TEXT NOT NULL,
      location_matched_name TEXT
    );
    CREATE TABLE conferences(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      classification TEXT,
      standings_method TEXT NOT NULL,
      coverage_complete INTEGER NOT NULL,
      source_url TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE teams(
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      gender TEXT NOT NULL,
      season TEXT NOT NULL,
      conference_id TEXT,
      active INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

const directoryHtml=`<!doctype html><html><body>
  <a href="https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/">6A Central Volleyball Standings</a>
</body></html>`;

const standingsHtml=`<!doctype html><html><body><table><tbody>
  <tr><td>1</td><td>Conway</td><td>1-0</td><td>1.000</td><td>5-4</td><td>.556</td></tr>
  <tr><td>4</td><td>Little Rock Southwest</td><td>0-1</td><td>.000</td><td>1-3</td><td>.250</td></tr>
</tbody></table></body></html>`;

test("published membership matcher accepts canonical/GIS aliases but refuses ambiguous schools",()=>{
  const conference={id:"6a-central",name:"6A Central",source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/"};
  const standingsByConference=new Map([["6a-central",{standings:[
    {school_name:"Conway"},
    {school_name:"Little Rock Southwest"},
    {school_name:"Central"}
  ]}]]);
  const built=buildVolleyballConferenceMembership({
    conferences:[conference],
    standingsByConference,
    localTeams:[
      {team_id:"conway-volleyball-2026",school_id:"conway",school_name:"Conway High School",location_matched_name:"Conway High School"},
      {team_id:"southwest-volleyball-2026",school_id:"southwest",school_name:"Southwest High School",location_matched_name:"Little Rock Southwest High School"},
      {team_id:"central-a-volleyball-2026",school_id:"central-a",school_name:"Central High School"},
      {team_id:"central-b-volleyball-2026",school_id:"central-b",school_name:"Central School"}
    ]
  });

  assert.deepEqual(built.assignments.map(row=>[row.team_id,row.conference_id]).sort(),[
    ["conway-volleyball-2026","6a-central-volleyball"],
    ["southwest-volleyball-2026","6a-central-volleyball"]
  ]);
  assert.equal(built.ambiguous.length,1);
  assert.equal(built.ambiguous[0].school_name,"Central");
  assert.equal(built.conferences[0].source_url,conference.source_url);
});

test("published 6A Central sync materializes Southwest membership with two set-based D1 statements and becomes zero-change",async()=>{
  const db=new DatabaseSync(":memory:");
  schema(db);
  const env={DB:d1FromSqlite(db)};
  const firstNow="2026-09-07T22:00:00.000Z";

  db.prepare("INSERT INTO schools VALUES(?,?,?,?,?)").run("conway","Conway High School","high-school","local","Conway High School");
  db.prepare("INSERT INTO schools VALUES(?,?,?,?,?)").run("southwest","Southwest High School","high-school","local","Little Rock Southwest High School");
  db.prepare("INSERT INTO conferences VALUES(?,?,?,?,?,?,?)").run("6a-central-volleyball","6A Central","6A Volleyball","calculated",0,"https://www.ahsaa.org/volleyball",firstNow);
  db.prepare("INSERT INTO teams VALUES(?,?,?,?,?,?,?,?)").run("conway-volleyball-2026","conway","volleyball","girls","2026","6a-central-volleyball",1,firstNow);
  db.prepare("INSERT INTO teams VALUES(?,?,?,?,?,?,?,?)").run("southwest-volleyball-2026","southwest","volleyball","girls","2026",null,1,firstNow);

  let fetches=0;
  const fetchFn=async url=>{
    fetches++;
    const value=String(url);
    if(value.includes("/conference/6a-central/")) return new Response(standingsHtml,{status:200,headers:{"content-type":"text/html"}});
    if(value.endsWith("/ar/volleyball/")) return new Response(directoryHtml,{status:200,headers:{"content-type":"text/html"}});
    return new Response("",{status:404});
  };

  const first=await syncPublishedVolleyballConferenceMembership(env,{fetchFn,now:new Date(firstNow)});
  assert.equal(first.status,"SUCCESS");
  assert.equal(first.discoveredConferences,1);
  assert.equal(first.fetchedConferences,1);
  assert.equal(first.assignments,2);
  assert.equal(first.d1Statements,2);
  assert.equal(first.conferenceWrites,1);
  assert.equal(first.teamWrites,1);
  assert.equal(fetches,2,"directory and one conference page should each be fetched once");

  const southwest=db.prepare("SELECT conference_id FROM teams WHERE id='southwest-volleyball-2026'").get();
  assert.equal(southwest.conference_id,"6a-central-volleyball");
  const conference=db.prepare("SELECT * FROM conferences WHERE id='6a-central-volleyball'").get();
  assert.equal(conference.standings_method,"published");
  assert.equal(conference.classification,"Arkansas high school volleyball");
  assert.equal(conference.source_url,"https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/");

  fetches=0;
  const second=await syncPublishedVolleyballConferenceMembership(env,{fetchFn,now:new Date("2026-09-07T22:05:00.000Z")});
  assert.equal(second.status,"SUCCESS");
  assert.equal(second.conferenceWrites,0);
  assert.equal(second.teamWrites,0);
  assert.equal(fetches,2);
});
