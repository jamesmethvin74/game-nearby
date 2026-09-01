import test from "node:test";
import assert from "node:assert/strict";
import { CURATED_SCHOOL_BRANDING_IDENTITIES } from "../src/school-branding-curated.js";

test("curated branding map covers known unresolved MaxPreps identities", () => {
  const names = new Set(CURATED_SCHOOL_BRANDING_IDENTITIES.flatMap(row => row.targetNames));
  for (const name of [
    "Abundant Life School-Sherwood",
    "Dardanelle High School",
    "Genoa Central High School",
    "Hot Springs World Class High School",
    "Kipp Blytheville Collegiate High School",
    "Midland Elementary School",
    "Nettleton Junior High School",
    "Piggott Elementary School",
    "Pocahontas Junior High School",
    "Academies At Rivercrest High School",
    "Southside High School"
  ]) assert.ok(names.has(name), `missing curated identity ${name}`);
});

test("curated MaxPreps identities use canonical Arkansas school pages", () => {
  for (const row of CURATED_SCHOOL_BRANDING_IDENTITIES.filter(row => !row.sourceType)) {
    assert.match(row.sourceUrl, /^https:\/\/www\.maxpreps\.com\/ar\//);
  }
});
