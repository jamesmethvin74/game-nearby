import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const inventory=JSON.parse(fs.readFileSync(new URL('../data/arkansas-high-school-team-inventory.json',import.meta.url),'utf8'));
const migrationDir=new URL('../migrations/',import.meta.url);
const migrationName='0013_milestone1_complete_team_materialization.sql';
const migrationSql=fs.readFileSync(new URL(migrationName,migrationDir),'utf8');

const CODE_BY_TEAM={
  'football|boys':'FB',
  'basketball|boys':'MBB',
  'basketball|girls':'WBB',
  'soccer|boys':'MSO',
  'soccer|girls':'WSO',
  'volleyball|girls':'WVB'
};

function buildThrough(maxMigration){
  const db=new DatabaseSync(':memory:');
  for(const file of fs.readdirSync(migrationDir).filter(name=>name.endsWith('.sql')&&name<=maxMigration).sort()){
    db.exec(fs.readFileSync(new URL(file,migrationDir),'utf8'));
  }
  return db;
}

function establishVerifiedProductionIdentityCheckpoint(db){
  const ids=JSON.stringify(Object.keys(inventory.certified_school_team_codes||{}));

  db.prepare(`
    WITH expected AS (SELECT value AS aaa_id FROM json_each(?))
    INSERT OR IGNORE INTO schools
      (id,name,city,state,level,catalog_scope,membership_source,membership_verified_at)
    SELECT
      'verified-' || lower(expected.aaa_id),
      expected.aaa_id,
      '',
      'AR',
      'high-school',
      'local',
      'aaa-certified',
      CURRENT_TIMESTAMP
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1 FROM school_external_identities identity
      WHERE identity.provider='dragonfly'
        AND identity.external_school_id=expected.aaa_id
    )
  `).run(ids);

  db.prepare(`
    WITH expected AS (SELECT value AS aaa_id FROM json_each(?))
    INSERT OR IGNORE INTO school_external_identities
      (provider,external_school_id,school_id,observed_name,last_seen_at,updated_at)
    SELECT
      'dragonfly',
      expected.aaa_id,
      'verified-' || lower(expected.aaa_id),
      expected.aaa_id,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1 FROM school_external_identities identity
      WHERE identity.provider='dragonfly'
        AND identity.external_school_id=expected.aaa_id
    )
  `).run(ids);

  const represented=Number(db.prepare(`
    SELECT COUNT(DISTINCT identity.external_school_id) AS n
    FROM school_external_identities identity
    JOIN json_each(?) expected ON expected.value=identity.external_school_id
    WHERE identity.provider='dragonfly'
  `).get(ids).n);
  assert.equal(represented,295,'test checkpoint must model the verified 295/295 production identities');
}

function productionLikeDatabase(){
  const db=buildThrough('0012_d1_read_budget_indexes.sql');
  establishVerifiedProductionIdentityCheckpoint(db);
  return db;
}

function count(db,table){
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function certifiedSupportedRows(db){
  const expectedIds=new Set(Object.keys(inventory.certified_school_team_codes||{}));
  return db.prepare(`
    SELECT i.external_school_id,t.id,t.sport,t.gender,t.season,t.active
    FROM teams t
    JOIN school_external_identities i
      ON i.school_id=t.school_id
     AND i.provider='dragonfly'
    WHERE t.season='2026'
      AND (
        (t.sport='football' AND t.gender='boys') OR
        (t.sport='basketball' AND t.gender IN ('boys','girls')) OR
        (t.sport='soccer' AND t.gender IN ('boys','girls')) OR
        (t.sport='volleyball' AND t.gender='girls')
      )
    ORDER BY i.external_school_id,t.sport,t.gender,t.id
  `).all().filter(row=>expectedIds.has(row.external_school_id));
}

test('0013 materializes all 1,102 certified 2026 supported team targets from the verified production identity checkpoint',()=>{
  const expectedMap=inventory.certified_school_team_codes||{};
  assert.equal(Object.keys(expectedMap).length,295);
  assert.equal(Object.values(expectedMap).reduce((sum,codes)=>sum+codes.length,0),1102);

  const db=productionLikeDatabase();
  db.exec(migrationSql);
  const rows=certifiedSupportedRows(db);
  assert.equal(rows.length,1102);

  const actual=new Map();
  for(const row of rows){
    assert.equal(row.season,'2026');
    assert.equal(row.active,1);
    const code=CODE_BY_TEAM[`${row.sport}|${row.gender}`];
    assert.ok(code,`unexpected supported team shape ${row.sport}/${row.gender}`);
    if(!actual.has(row.external_school_id)) actual.set(row.external_school_id,[]);
    actual.get(row.external_school_id).push(code);
  }

  assert.equal(actual.size,295);
  for(const [aaaId,expectedCodes] of Object.entries(expectedMap)){
    assert.deepEqual((actual.get(aaaId)||[]).sort(),[...expectedCodes].sort(),`team targets differ for ${aaaId}`);
  }

  db.exec(migrationSql);
  assert.equal(certifiedSupportedRows(db).length,1102,'0013 must remain idempotent');
});

test('0013 changes team inventory only and leaves runtime sports data untouched',()=>{
  const db=productionLikeDatabase();
  const before={
    sources:count(db,'sources'),
    games:count(db,'games'),
    records:count(db,'team_records'),
    standings:count(db,'standings')
  };

  db.exec(migrationSql);

  const after={
    sources:count(db,'sources'),
    games:count(db,'games'),
    records:count(db,'team_records'),
    standings:count(db,'standings')
  };
  assert.deepEqual(after,before);
  assert.equal(certifiedSupportedRows(db).length,1102);
});

test('0013 is one persistent set-based DML statement with no collection side effects',()=>{
  const withoutComments=migrationSql.replace(/--.*$/gm,'');
  const inserts=(withoutComments.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+teams\b/gi)||[]).length;
  assert.equal(inserts,1);
  assert.doesNotMatch(withoutComments,/\b(?:INSERT|UPDATE|DELETE)\s+(?:OR\s+IGNORE\s+)?(?:INTO\s+)?(?:schools|school_external_identities|sources|games|team_records|standings)\b/i);
  assert.doesNotMatch(withoutComments,/\b(?:fetch|http|https):?\/\//i);
});
