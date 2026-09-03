import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const data=JSON.parse(fs.readFileSync(new URL('../data/arkansas-high-school-production-reconciliation.json',import.meta.url),'utf8'));

const expectedCodes=new Set(['FB','MBB','WBB','MSO','WSO','WVB']);

test('Milestone 1 production reconciliation has the expected checkpoint counts',()=>{
  assert.equal(data.version,'milestone1-aaa-production-reconciliation-v1');
  assert.equal(data.status,'checkpoint-not-final');
  assert.equal(data.summary.aaa_certified_schools,295);
  assert.equal(data.summary.production_high_schools,195);
  assert.equal(data.summary.matched_aaa_schools,184);
  assert.equal(data.summary.aaa_not_in_or_not_matched_to_production,111);
  assert.equal(data.summary.production_schools_not_matched_to_aaa,11);
  assert.equal(data.summary.matched_team_targets,814);
  assert.equal(data.summary.aaa_team_targets,1102);
});

test('The 111-school gap contains exactly 288 supported team targets',()=>{
  assert.equal(data.aaa_certified_schools_not_in_production.length,111);
  let targets=0;
  const ids=new Set();
  for(const row of data.aaa_certified_schools_not_in_production){
    assert.ok(row.aaa_id);
    assert.ok(row.school_name);
    assert.ok(!ids.has(row.aaa_id),`duplicate AAA school ${row.aaa_id}`);
    ids.add(row.aaa_id);
    for(const code of row.team_codes){
      assert.ok(expectedCodes.has(code),`unsupported code ${code}`);
      targets++;
    }
  }
  assert.equal(targets,288);
  assert.deepEqual(data.missing_team_targets_by_code,{MBB:107,WBB:103,FB:56,MSO:11,WSO:10,WVB:1});
});

test('Production-only rows remain explicitly visible for cleanup/review',()=>{
  assert.equal(data.production_high_school_rows_not_in_certified_aaa_295.length,11);
  const ids=new Set(data.production_high_school_rows_not_in_certified_aaa_295.map(row=>row.school_id));
  for(const id of ['df-a6slv2','df-vs7zsu','df-2tng4g','df-qscp6x','df-urlzfa','df-25lkrp']) assert.ok(ids.has(id));
});
