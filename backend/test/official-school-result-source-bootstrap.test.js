import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const migration=fs.readFileSync(
  fileURLToPath(new URL("../migrations/0014_official_school_final_result_sources.sql",import.meta.url)),
  "utf8"
);

test("official result source bootstrap is source-only and covers the four current result sports",()=>{
  assert.match(migration,/INSERT INTO sources/);
  assert.doesNotMatch(migration,/INSERT\s+INTO\s+games/i);
  assert.doesNotMatch(migration,/UPDATE\s+canonical_events/i);
  assert.doesNotMatch(migration,/DELETE\s+FROM/i);
  assert.match(migration,/sport='football'.*gender='boys'/s);
  assert.match(migration,/sport='volleyball'.*gender='girls'/s);
  assert.match(migration,/sport='basketball'.*gender='boys'/s);
  assert.match(migration,/sport='basketball'.*gender='girls'/s);
});

test("official result source bootstrap uses certified identities and only Mascot published schedule pages",()=>{
  for (const aaaId of ["HNHRP8","SE48QJ","YF5Y8Q","7RXKJC","KQ5HLR","2TR733","BQP5SF"]) {
    assert.match(migration,new RegExp(aaaId));
  }
  assert.match(migration,/identity\.provider='dragonfly'/);
  assert.match(migration,/'official-school'/);
  assert.match(migration,/'mascot-media'/);
  assert.match(migration,/\/sport\/football\/boys\/\?tab=schedule/);
  assert.match(migration,/\/sport\/volleyball\/girls\/\?tab=schedule/);
  assert.match(migration,/\/sport\/basketball\/boys\/\?tab=schedule/);
  assert.match(migration,/\/sport\/basketball\/girls\/\?tab=schedule/);
});
