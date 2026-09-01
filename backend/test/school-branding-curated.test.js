import test from "node:test";
import assert from "node:assert/strict";
import { CURATED_SCHOOL_BRANDING_IDENTITIES } from "../src/school-branding-curated.js";

test("curated branding map covers the 27 production unresolved identities", () => {
  const names = new Set(CURATED_SCHOOL_BRANDING_IDENTITIES.flatMap(row => row.targetNames));
  const expected = [
    "Abundant Life School-Sherwood",
    "Academies At Rivercrest High School",
    "Dardanelle High School",
    "Exalt Academy Of Southwest Little Rock",
    "Founders Classical Academies Of Arkansas Rogers",
    "Friendship Aspire Academy Southeast Pine Bluff",
    "Garrett Memorial Christian School",
    "Genoa Central High School",
    "Kipp Blytheville Collegiate High School",
    "Kipp Delta Elementary Literacy Academy",
    "Kirby High School",
    "Lincoln Academy",
    "Mammoth Spring High School",
    "Midland Elementary School",
    "Mountainburg High School",
    "Mulberry High School",
    "Nettleton Junior High School",
    "Norfork High School",
    "Piggott Elementary School",
    "Pocahontas Junior High School",
    "Riverside High School",
    "Southside Charter High School",
    "Spring Hill High School",
    "Stuttgart High School",
    "Trumann High School",
    "Viola High School",
    "Watson Chapel High School"
  ];
  assert.equal(CURATED_SCHOOL_BRANDING_IDENTITIES.length, 27);
  for (const name of expected) assert.ok(names.has(name), `missing curated identity ${name}`);
});

test("every curated identity pins an explicit logo URL", () => {
  for (const row of CURATED_SCHOOL_BRANDING_IDENTITIES) {
    assert.ok(/^https:\/\//.test(row.logoUrl || ""), `missing explicit logo URL for ${row.sourceName}`);
  }
});

test("curated MaxPreps identities use canonical Arkansas school pages", () => {
  for (const row of CURATED_SCHOOL_BRANDING_IDENTITIES.filter(row => !row.sourceType)) {
    assert.match(row.sourceUrl, /^https:\/\/www\.maxpreps\.com\/ar\//);
  }
});
