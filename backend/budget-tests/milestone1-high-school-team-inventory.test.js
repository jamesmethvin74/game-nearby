import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const inventory=JSON.parse(fs.readFileSync(new URL('../data/arkansas-high-school-team-inventory.json',import.meta.url),'utf8'));
const names=JSON.parse(fs.readFileSync(new URL('../data/arkansas-high-school-team-inventory-names.json',import.meta.url),'utf8'));

const expectedCodes=new Set(['FB','MBB','WBB','MSO','WSO','WVB']);

test('Milestone 1 high school checkpoint has the certified statewide denominator',()=>{
  assert.equal(inventory.version,'milestone1-high-school-team-inventory-v1');
  assert.equal(inventory.status,'checkpoint-not-final');
  assert.equal(inventory.summary.dragonfly_participant_orgs_seen,471);
  assert.equal(inventory.summary.certified_arkansas_high_school_orgs,295);
  assert.equal(inventory.summary.certified_expected_team_targets,1102);
  assert.equal(Object.keys(inventory.certified_school_team_codes).length,295);
  assert.equal(Object.keys(names.certified_school_names).length,295);
  assert.deepEqual(inventory.per_sport,{
    'basketball/boys':286,
    'basketball/girls':281,
    'football/boys':194,
    'soccer/boys':79,
    'soccer/girls':77,
    'volleyball/girls':185
  });
});

test('certified team targets are unique and use only supported team codes',()=>{
  let targets=0;
  for (const [schoolId,codes] of Object.entries(inventory.certified_school_team_codes)) {
    assert.ok(names.certified_school_names[schoolId],`missing certified name for ${schoolId}`);
    assert.equal(new Set(codes).size,codes.length,`duplicate team code for ${schoolId}`);
    for (const code of codes) assert.ok(expectedCodes.has(code),`unsupported team code ${code}`);
    targets+=codes.length;
  }
  assert.equal(targets,1102);
});

test('lower-grade and unresolved provider orgs are quarantined from certified schools',()=>{
  const certified=new Set(Object.keys(inventory.certified_school_team_codes));
  assert.equal(inventory.excluded_lower_grade_ids.length,20);
  assert.equal(inventory.unresolved_provider_org_ids.length,155);
  for (const id of inventory.excluded_lower_grade_ids) assert.ok(!certified.has(id),`lower-grade org certified: ${id}`);
  for (const id of inventory.unresolved_provider_org_ids) assert.ok(!certified.has(id),`unresolved org certified: ${id}`);
  for (const name of Object.values(names.certified_school_names)) {
    assert.ok(!/\b(?:elementary|middle school|junior high|jr\.? high)\b/i.test(name),`lower-grade name certified: ${name}`);
  }
});
