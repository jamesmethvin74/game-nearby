import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { collegeCatalogSeed } from "../src/college-catalog.js";
import { SOURCE_INSERT_SQL, certifiedCollegeSourceRows } from "../src/college-source-bootstrap.js";
import { parserReadyCollegeSourceCandidates } from "../src/college-source-resolution.js";

const migrationDir=new URL("../migrations/",import.meta.url);
function buildDb(){
  const db=new DatabaseSync(":memory:");
  for(const file of fs.readdirSync(migrationDir).filter(name=>name.endsWith(".sql")).sort()) db.exec(fs.readFileSync(new URL(file,migrationDir),"utf8"));
  return db;
}

function key(row){return `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`;}

test("M3 source bootstrap can represent exactly the 98 currently parser-ready targets",()=>{
  const candidates=parserReadyCollegeSourceCandidates("2026");
  const certified=new Set(candidates.map(key));
  const rows=certifiedCollegeSourceRows(certified,"2026");
  assert.equal(rows.length,98);
  assert.equal(new Set(rows.map(row=>row.sourceId)).size,98);
  assert.equal(rows.filter(row=>row.parserType==="sidearm").length,75);
  assert.equal(rows.filter(row=>row.parserType==="sidearm-modern").length,4);
  assert.equal(rows.filter(row=>row.parserType==="arkansas-razorbacks").length,5);
  assert.equal(rows.filter(row=>row.parserType==="institutional-table").length,2);
  assert.equal(rows.filter(row=>row.parserType==="prestosports-rss").length,12);
  assert.ok(rows.every(row=>row.activeResultMinutes===30));
});

test("M3 source bootstrap only emits explicitly certified keys",()=>{
  const candidates=parserReadyCollegeSourceCandidates("2026");
  const selected=new Set(candidates.slice(0,3).map(key));
  const rows=certifiedCollegeSourceRows(selected,"2026");
  assert.equal(rows.length,3);
  assert.deepEqual(new Set(rows.map(key)),selected);
});

test("M3 source materialization is one set-based disabled insert with no schedule side effects",()=>{
  const db=buildDb();
  const seed=collegeCatalogSeed("2026");
  db.prepare(`WITH incoming AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.name') name,json_extract(value,'$.city') city,json_extract(value,'$.state') state,json_extract(value,'$.mascot') mascot FROM json_each(?)) INSERT OR IGNORE INTO schools(id,name,city,state,level,mascot,catalog_scope,membership_source,membership_verified_at) SELECT id,name,city,state,'college',mascot,'local','m3-college-inventory',CURRENT_TIMESTAMP FROM incoming`).run(JSON.stringify(seed.schools));
  db.prepare(`WITH incoming AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.schoolId') school_id,json_extract(value,'$.sport') sport,json_extract(value,'$.gender') gender,json_extract(value,'$.season') season FROM json_each(?)) INSERT OR IGNORE INTO teams(id,school_id,sport,gender,season,active) SELECT id,school_id,sport,gender,season,1 FROM incoming WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.school_id=incoming.school_id AND t.sport=incoming.sport AND t.gender=incoming.gender AND t.season=incoming.season)`).run(JSON.stringify(seed.teams));

  const candidates=parserReadyCollegeSourceCandidates("2026");
  const rows=certifiedCollegeSourceRows(new Set(candidates.map(key)),"2026");
  const before={games:Number(db.prepare("SELECT COUNT(*) n FROM games").get().n),records:Number(db.prepare("SELECT COUNT(*) n FROM team_records").get().n),standings:Number(db.prepare("SELECT COUNT(*) n FROM standings").get().n)};
  const result=db.prepare(SOURCE_INSERT_SQL).run(JSON.stringify(rows));
  assert.equal(Number(result.changes),98);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM sources WHERE id LIKE 'college-%'").get().n),98);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM sources WHERE id LIKE 'college-%' AND enabled=1").get().n),0);
  assert.deepEqual({games:Number(db.prepare("SELECT COUNT(*) n FROM games").get().n),records:Number(db.prepare("SELECT COUNT(*) n FROM team_records").get().n),standings:Number(db.prepare("SELECT COUNT(*) n FROM standings").get().n)},before);

  const withoutComments=SOURCE_INSERT_SQL.replace(/--.*$/gm,"");
  assert.equal((withoutComments.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+sources/gi)||[]).length,1);
  assert.doesNotMatch(withoutComments,/\b(?:INSERT|UPDATE|DELETE)\s+(?:OR\s+IGNORE\s+)?(?:INTO\s+)?(?:games|canonical_events|team_records|standings)\b/i);
});
