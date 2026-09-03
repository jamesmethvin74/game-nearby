import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const reconciliation=JSON.parse(fs.readFileSync(new URL('../data/arkansas-high-school-production-reconciliation.json',import.meta.url),'utf8'));
const migrationUrl=new URL('../migrations/0011_milestone1_aaa_catalog_completion.sql',import.meta.url);
const migrationSql=fs.readFileSync(migrationUrl,'utf8');
const CHECKPOINT_MIGRATION='0011_milestone1_aaa_catalog_completion.sql';

const CODE_BY_TEAM={
  'football|boys':'FB',
  'basketball|boys':'MBB',
  'basketball|girls':'WBB',
  'soccer|boys':'MSO',
  'soccer|girls':'WSO',
  'volleyball|girls':'WVB'
};

function buildDatabase(){
  const db=new DatabaseSync(':memory:');
  const migrationDir=new URL('../migrations/',import.meta.url);
  for(const file of fs.readdirSync(migrationDir).filter(name=>name.endsWith('.sql')&&name<=CHECKPOINT_MIGRATION).sort()){
    db.exec(fs.readFileSync(new URL(file,migrationDir),'utf8'));
  }
  return db;
}

function expectedTargets(){
  const targets=new Map();
  for(const row of reconciliation.aaa_certified_schools_not_in_production){
    targets.set(row.aaa_id,new Set(row.team_codes));
  }
  return targets;
}

test('0011 seeds exactly the 111 certified AAA schools and 288 expected team targets',()=>{
  assert.equal(reconciliation.aaa_certified_schools_not_in_production.length,111);
  assert.equal(reconciliation.aaa_certified_schools_not_in_production.reduce((sum,row)=>sum+row.team_codes.length,0),288);

  const db=buildDatabase();
  const schools=db.prepare(`
    SELECT id,name,state,level,catalog_scope,membership_source
    FROM schools
    WHERE membership_source='aaa-certified'
    ORDER BY id
  `).all();
  assert.equal(schools.length,111);

  const schoolById=new Map(schools.map(row=>[row.id,row]));
  for(const expected of reconciliation.aaa_certified_schools_not_in_production){
    const id=`aaa-${expected.aaa_id.toLowerCase()}`;
    const school=schoolById.get(id);
    assert.ok(school,`missing certified school ${expected.aaa_id}`);
    assert.equal(school.name,expected.school_name);
    assert.equal(school.state,'AR');
    assert.equal(school.level,'high-school');
    assert.equal(school.catalog_scope,'local');
  }

  const identities=db.prepare(`
    SELECT external_school_id,school_id
    FROM school_external_identities
    WHERE provider='dragonfly' AND school_id LIKE 'aaa-%'
    ORDER BY external_school_id
  `).all();
  assert.equal(identities.length,111);
  for(const identity of identities){
    assert.equal(identity.school_id,`aaa-${identity.external_school_id.toLowerCase()}`);
  }

  const teams=db.prepare(`
    SELECT i.external_school_id,t.sport,t.gender,t.season,t.active
    FROM teams t
    JOIN school_external_identities i ON i.school_id=t.school_id AND i.provider='dragonfly'
    JOIN schools s ON s.id=t.school_id
    WHERE s.membership_source='aaa-certified'
    ORDER BY i.external_school_id,t.sport,t.gender
  `).all();
  assert.equal(teams.length,288);

  const actualTargets=new Map();
  const actualByCode={MBB:0,WBB:0,FB:0,MSO:0,WSO:0,WVB:0};
  for(const team of teams){
    assert.equal(team.season,'2026');
    assert.equal(team.active,1);
    const code=CODE_BY_TEAM[`${team.sport}|${team.gender}`];
    assert.ok(code,`unexpected team shape ${team.sport}/${team.gender}`);
    if(!actualTargets.has(team.external_school_id)) actualTargets.set(team.external_school_id,new Set());
    actualTargets.get(team.external_school_id).add(code);
    actualByCode[code]++;
  }

  const expected=expectedTargets();
  assert.equal(actualTargets.size,expected.size);
  for(const [aaaId,codes] of expected){
    assert.deepEqual([...actualTargets.get(aaaId)||[]].sort(),[...codes].sort(),`team targets differ for ${aaaId}`);
  }
  assert.deepEqual(actualByCode,reconciliation.missing_team_targets_by_code);
});

test('0011 is inventory-only and leaves schedule/result tables untouched for the new AAA catalog',()=>{
  const db=buildDatabase();
  const sourceCount=db.prepare(`
    SELECT COUNT(*) AS n
    FROM sources src JOIN teams t ON t.id=src.team_id JOIN schools s ON s.id=t.school_id
    WHERE s.membership_source='aaa-certified'
  `).get().n;
  const gameCount=db.prepare(`
    SELECT COUNT(*) AS n
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id
    WHERE s.membership_source='aaa-certified'
  `).get().n;
  const recordCount=db.prepare(`
    SELECT COUNT(*) AS n
    FROM team_records r JOIN teams t ON t.id=r.team_id JOIN schools s ON s.id=t.school_id
    WHERE s.membership_source='aaa-certified'
  `).get().n;
  const standingsCount=db.prepare(`
    SELECT COUNT(*) AS n
    FROM standings st JOIN teams t ON t.id=st.team_id JOIN schools s ON s.id=t.school_id
    WHERE s.membership_source='aaa-certified'
  `).get().n;

  assert.equal(sourceCount,0);
  assert.equal(gameCount,0);
  assert.equal(recordCount,0);
  assert.equal(standingsCount,0);
});

test('0011 keeps persistent D1 mutation bounded to four set-based statements',()=>{
  const withoutComments=migrationSql.replace(/--.*$/gm,'');
  const schoolInserts=(withoutComments.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+schools\b/gi)||[]).length;
  const identityInserts=(withoutComments.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+school_external_identities\b/gi)||[]).length;
  const schoolUpdates=(withoutComments.match(/UPDATE\s+schools\b/gi)||[]).length;
  const teamInserts=(withoutComments.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+teams\b/gi)||[]).length;
  assert.deepEqual({schoolInserts,identityInserts,schoolUpdates,teamInserts},{schoolInserts:1,identityInserts:1,schoolUpdates:1,teamInserts:1});

  assert.doesNotMatch(withoutComments,/\b(?:INSERT|UPDATE|DELETE)\b[\s\S]{0,80}\b(?:sources|games|team_records|standings)\b/i);
  assert.doesNotMatch(withoutComments,/\b(?:fetch|http|https):?\/\//i);

  const db=buildDatabase();
  const leftover=db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='view' AND name='_m1_aaa_catalog_seed'").get().n;
  assert.equal(leftover,0);
});
