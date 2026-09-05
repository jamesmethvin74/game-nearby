import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const migration=fs.readFileSync(
  fileURLToPath(new URL("../migrations/0015_official_school_final_result_sources_batch2.sql",import.meta.url)),
  "utf8"
);

const expectedSites={
  WD92V5:"almaairedales.com",
  D8JJ4R:"arkadelphiabadgertv.com",
  S7358S:"gobentonvillewestwolverines.com",
  KTPGZC:"boonevillebearcats.com",
  YGAV2L:"chsrockets.com",
  "8PKUD7":"huntsvilleathletics.com",
  DXGR8R:"mhbombersports.com",
  LWDSHK:"scrappersports.com",
  HRDB8F:"chargingwildcatathletics.com",
  JBCLSD:"lrparkviewathletics.com",
  "7X4SXH":"pearidgeathletics.com",
  QG2ANT:"rogersmounties.com",
  BF8ZXN:"gowareagles.com",
  BKC4UX:"lrsouthwestathletics.com"
};

test("batch 2 seeds only confirmed Mascot school source domains",()=>{
  for (const [aaaId,domain] of Object.entries(expectedSites)) {
    assert.match(migration,new RegExp(aaaId));
    assert.match(migration,new RegExp(domain.replaceAll(".","\\.")));
  }
  assert.equal(Object.keys(expectedSites).length,14);
  assert.match(migration,/'mascot-media'/);
  assert.match(migration,/identity\.provider='dragonfly'/);
});

test("batch 2 remains source-only and covers the four requested result sports",()=>{
  assert.match(migration,/INSERT OR IGNORE INTO sources/);
  assert.doesNotMatch(migration,/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+games/i);
  assert.doesNotMatch(migration,/UPDATE\s+canonical_events/i);
  assert.doesNotMatch(migration,/DELETE\s+FROM/i);
  for (const path of [
    "/sport/football/boys/?tab=schedule",
    "/sport/volleyball/girls/?tab=schedule",
    "/sport/basketball/boys/?tab=schedule",
    "/sport/basketball/girls/?tab=schedule"
  ]) assert.ok(migration.includes(path));
});
