import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_SCHOOL_RESULT_SPORTS,
  OFFICIAL_SCHOOL_SOURCE_CATALOG,
  buildOfficialSchoolResultSourceMigrationSql
} from "../src/official-school-source-catalog.js";
import { discoverOfficialSchoolCandidate } from "../scripts/discover-official-school-result-sources.mjs";

const migration=fs.readFileSync(
  fileURLToPath(new URL("../migrations/0016_official_school_final_result_sources_batch3.sql",import.meta.url)),
  "utf8"
);

test("batch 3 adds only volleyball and boys/girls basketball official-school sources",()=>{
  assert.deepEqual(OFFICIAL_SCHOOL_RESULT_SPORTS,[
    "volleyball-girls","basketball-boys","basketball-girls"
  ]);
  assert.match(migration,/t\.sport='volleyball'/);
  assert.match(migration,/t\.sport='basketball'/);
  assert.doesNotMatch(migration,/t\.sport='football'/);
  assert.doesNotMatch(migration,/t\.sport='baseball'/);
  assert.doesNotMatch(migration,/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+games/i);
  assert.doesNotMatch(migration,/UPDATE\s+canonical_events/i);
  assert.doesNotMatch(migration,/DELETE\s+FROM/i);
});

test("batch 3 catalog contains the newly verified Mascot schools",()=>{
  const expected=new Map([
    ["farmington","farmcardsathletics.org"],
    ["morrilton","morriltonathletics.com"],
    ["gravette","gravetteathletics.net"],
    ["gentry","gentryathletics.com"],
    ["cutter-morning-star","cmseaglesathletics.com"]
  ]);
  assert.equal(OFFICIAL_SCHOOL_SOURCE_CATALOG.length,expected.size);
  for(const site of OFFICIAL_SCHOOL_SOURCE_CATALOG){
    assert.equal(site.parserType,"mascot-media");
    assert.equal(new URL(site.baseUrl).hostname,expected.get(site.key));
    assert.equal(site.verifiedAt,"2026-09-23");
    assert.deepEqual(site.sports,OFFICIAL_SCHOOL_RESULT_SPORTS);
  }
});

test("checked-in batch 3 migration is generated from the catalog",()=>{
  assert.equal(
    migration,
    buildOfficialSchoolResultSourceMigrationSql(OFFICIAL_SCHOOL_SOURCE_CATALOG,{season:"2026",batchLabel:"batch 3"})
  );
});

test("discovery probe identifies Mascot and sport endpoints without activating anything",async()=>{
  const seen=[];
  const fetchFn=async url=>{
    seen.push(url);
    return new Response("<html><footer>© 2026 MASCOT MEDIA, LLC</footer></html>",{
      status:200,
      headers:{"content-type":"text/html"}
    });
  };
  const result=await discoverOfficialSchoolCandidate("https://example.test",{fetchFn});
  assert.equal(result.provider,"mascot-media");
  assert.equal(result.ready,true);
  assert.deepEqual(result.supportedSports,OFFICIAL_SCHOOL_RESULT_SPORTS);
  assert.equal(seen.length,4);
});
