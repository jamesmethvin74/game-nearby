import test from "node:test";
import assert from "node:assert/strict";
import {
  HIGH_SCHOOL_LOGO_BATCH_LIMIT,
  MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS,
  MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS,
  buildHighSchoolLogoCandidates
} from "../src/statewide-logo-completion.js";
import {
  COLLEGE_LOGO_BATCH_LIMIT,
  collegeBrandingSourceUrls,
  parseOfficialCollegeLogo
} from "../src/college-logo-bootstrap.js";
import { COLLEGE_SOURCE_PLATFORMS } from "../src/college-source-platforms.js";

test("high-school logo completion is bounded and uses basketball plus volleyball directories", () => {
  assert.equal(HIGH_SCHOOL_LOGO_BATCH_LIMIT, 25);
  assert.equal(MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS, "https://www.maxpreps.com/ar/basketball/schools/");
  assert.equal(MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS, "https://www.maxpreps.com/ar/volleyball/schools/");
});

test("reviewed lower-grade identities cannot re-enter logo completion", () => {
  const schools = [
    { id:"df-a6slv2", name:"Exalt Academy Of Southwest Little Rock", city:"Little Rock", level:"high-school" },
    { id:"df-2tng4g", name:"Kipp Delta Elementary Literacy Academy", city:"West Helena", level:"high-school" },
    { id:"school-demo", name:"Demo High School", city:"Demo", level:"high-school" }
  ];
  const basketballEntries = [{
    externalSchoolId:"00000000-0000-0000-0000-000000000001",
    name:"Demo High School",
    city:"Demo",
    logoUrl:"https://image.maxpreps.io/school-mascot/0/0/0/00000000-0000-0000-0000-000000000001.gif",
    sourceUrl:"https://www.maxpreps.com/ar/demo/demo-high-school/"
  }];
  const rows = buildHighSchoolLogoCandidates({ schools, basketballEntries, volleyballEntries:[], aliases:[] });
  const ids = new Set(rows.map(row => row.schoolId));
  assert.ok(ids.has("df-a6slv2"), "reviewed varsity keep must remain eligible");
  assert.ok(ids.has("school-demo"), "ordinary varsity school must remain eligible");
  assert.ok(!ids.has("df-2tng4g"), "reviewed elementary identity must remain excluded");
  assert.equal(rows.find(row => row.schoolId === "df-a6slv2")?.status, "curated");
});

test("college logo bootstrap is bounded and every college has an official branding source", () => {
  assert.equal(COLLEGE_LOGO_BATCH_LIMIT, 8);
  assert.equal(COLLEGE_SOURCE_PLATFORMS.length, 36);
  for (const row of COLLEGE_SOURCE_PLATFORMS) {
    assert.ok(collegeBrandingSourceUrls(row.schoolId).length > 0, `missing college branding source for ${row.schoolId}`);
  }
});

test("official college logo parser prefers explicit logo metadata", () => {
  const html = `
    <html><head>
      <meta property="og:image" content="/hero.jpg">
      <script type="application/ld+json">{"@type":"CollegeOrUniversity","name":"Example","logo":{"url":"/assets/athletics-logo.svg"}}</script>
    </head><body><img class="header-logo" src="/assets/header.png"></body></html>`;
  const result = parseOfficialCollegeLogo(html, "https://example.edu/athletics/");
  assert.equal(result?.url, "https://example.edu/assets/athletics-logo.svg");
  assert.equal(result?.method, "jsonld-logo");
});
