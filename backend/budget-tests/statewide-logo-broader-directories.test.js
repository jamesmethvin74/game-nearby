import test from "node:test";
import assert from "node:assert/strict";
import {
  HIGH_SCHOOL_LOGO_BATCH_LIMIT,
  MAXPREPS_ARKANSAS_ALL_SCHOOLS,
  MAXPREPS_ARKANSAS_FOOTBALL_SCHOOLS,
  MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS,
  MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS,
  buildHighSchoolLogoCandidates
} from "../src/statewide-logo-completion.js";

test("high-school logo completion keeps the 25-school cap and uses four authoritative directories", () => {
  assert.equal(HIGH_SCHOOL_LOGO_BATCH_LIMIT, 25);
  assert.equal(MAXPREPS_ARKANSAS_ALL_SCHOOLS, "https://www.maxpreps.com/ar/schools/");
  assert.equal(MAXPREPS_ARKANSAS_FOOTBALL_SCHOOLS, "https://www.maxpreps.com/ar/football/schools/");
  assert.equal(MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS, "https://www.maxpreps.com/ar/basketball/schools/");
  assert.equal(MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS, "https://www.maxpreps.com/ar/volleyball/schools/");
});

test("all-schools entries can recover a logo absent from basketball and volleyball", () => {
  const schools = [{ id:"aaa-demo", name:"Demo High School", city:"Demo", level:"high-school" }];
  const allSchoolEntries = [{
    externalSchoolId:"00000000-0000-0000-0000-000000000001",
    name:"Demo High School",
    city:"Demo",
    logoUrl:"https://image.maxpreps.io/school-mascot/0/0/0/00000000-0000-0000-0000-000000000001.gif",
    sourceUrl:"https://www.maxpreps.com/ar/demo/demo-high-school/"
  }];
  const rows = buildHighSchoolLogoCandidates({ schools, allSchoolEntries });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].schoolId, "aaa-demo");
  assert.equal(rows[0].status, "matched");
});
