import test from "node:test";
import assert from "node:assert/strict";
import { CURATED_SCHOOL_BRANDING_IDENTITIES } from "../src/school-branding-curated.js";

test("every curated identity has a source and at least one target name", () => {
  for (const row of CURATED_SCHOOL_BRANDING_IDENTITIES) {
    assert.ok(Array.isArray(row.targetNames) && row.targetNames.length > 0);
    assert.match(row.sourceUrl, /^https:\/\//);
    assert.ok(row.sourceName);
  }
});

test("traditional MaxPreps reconciliations carry mascot names", () => {
  const maxpreps = CURATED_SCHOOL_BRANDING_IDENTITIES.filter(row => !row.sourceType);
  const allowedMissingMascot = new Set(["Founders Classical Academy"]);
  for (const row of maxpreps) {
    if (allowedMissingMascot.has(row.sourceName)) continue;
    assert.ok(row.mascot, `missing mascot for ${row.sourceName}`);
  }
});
