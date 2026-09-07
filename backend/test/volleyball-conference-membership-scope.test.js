import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { syncPublishedVolleyballConferenceMembership } from "../src/volleyball-conference-membership.js";

function d1(db){const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async all(){return{results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){return db.prepare(sql).run(...args)}}};return{prepare,async batch(xs){const out=[];for(const x of xs)out.push(await x.run());return out}}}

const directory=`<a href="https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/">6A Central Volleyball Standings</a>`;
const standings=`<table><tr><td>1</td><td>Conway</td><td>1-0</td><td>1.000</td><td>5-4</td><td>.556</td></tr><tr><td>4</td><td>Little Rock Southwest</td><td>0-1</td><td>.000</td><td>1-3</td><td>.250</td></tr></table>`;

test("production scope fetches only 6A Central and updates only Southwest",async()=>{
  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schools(id TEXT PRIMARY KEY,name TEXT,level TEXT,catalog_scope TEXT,location_matched_name TEXT);
    CREATE TABLE conferences(id TEXT PRIMARY KEY,name TEXT,classification TEXT,standings_method TEXT,coverage_complete INTEGER,source_url TEXT,updated_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,school_id TEXT,sport TEXT,gender TEXT,season TEXT,conference_id TEXT,active INTEGER,updated_at TEXT);
  `);
  const now="2026-09-07T22:00:00.000Z";
  db.prepare("INSERT INTO schools VALUES(?,?,?,?,?)").run("conway","Conway High School","high-school","local","Conway High School");
  db.prepare("INSERT INTO schools VALUES(?,?,?,?,?)").run("southwest","Southwest High School","high-school","local","Little Rock Southwest High School");
  db.prepare("INSERT INTO conferences VALUES(?,?,?,?,?,?,?)").run("6a-central-volleyball","6A Central","6A Volleyball","calculated",0,null,now);
  db.prepare("INSERT INTO teams VALUES(?,?,?,?,?,?,?,?)").run("conway-volleyball-2026","conway","volleyball","girls","2026","6a-central-volleyball",1,now);
  db.prepare("INSERT INTO teams VALUES(?,?,?,?,?,?,?,?)").run("southwest-volleyball-2026","southwest","volleyball","girls","2026",null,1,now);
  let fetches=0;
  const fetchFn=async url=>{fetches++;const u=String(url);return new Response(u.includes('/conference/6a-central/')?standings:directory,{status:200});};
  const result=await syncPublishedVolleyballConferenceMembership({DB:d1(db)},{
    fetchFn,now:new Date(now),conferenceIds:["6a-central"],targetTeamIds:["southwest-volleyball-2026"]
  });
  assert.equal(result.status,"SUCCESS");
  assert.equal(result.selectedConferences,1);
  assert.equal(result.assignments,1);
  assert.equal(result.teamWrites,1);
  assert.equal(fetches,2);
  assert.equal(db.prepare("SELECT conference_id FROM teams WHERE id='southwest-volleyball-2026'").get().conference_id,"6a-central-volleyball");
  assert.equal(db.prepare("SELECT conference_id FROM teams WHERE id='conway-volleyball-2026'").get().conference_id,"6a-central-volleyball");
});
