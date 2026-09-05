import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
import {
  LOGO_BOOTSTRAP_READY_PATH,
  authorizedLogoBootstrap,
  logoBootstrapReadiness
} from "../src/logo-bootstrap-worker.js";

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

test("college logo completion includes zero-supported-team colleges", () => {
  const source = fs.readFileSync(new URL("../src/college-logo-bootstrap.js", import.meta.url), "utf8");
  assert.match(source, /s\.catalog_scope='local' AND s\.level='college'/);
  assert.doesNotMatch(source, /EXISTS\(SELECT 1 FROM teams t WHERE t\.school_id=s\.id AND t\.active=1\)/);
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

test("approved execution uses a fresh ephemeral logo token with readiness proof", async () => {
  assert.equal(LOGO_BOOTSTRAP_READY_PATH, "/api/v1/content/logo-bootstrap/ready");
  const env = { LOGO_BOOTSTRAP_TOKEN:"secret", REFRESH_TOKEN:"refresh" };
  const good = new Request("https://example.test/api/v1/content/logo-bootstrap/ready", { method:"HEAD", headers:{ "x-logo-bootstrap-token":"secret" } });
  const bad = new Request("https://example.test/api/v1/content/logo-bootstrap/ready", { method:"HEAD", headers:{ "x-logo-bootstrap-token":"wrong" } });
  assert.equal(authorizedLogoBootstrap(good, env), true);
  assert.equal(logoBootstrapReadiness(good, env).status, 204);
  assert.equal(logoBootstrapReadiness(bad, env).status, 404);
});

test("approved production script isolates execution in a sibling Worker and performs one combined D1 verification", () => {
  const source = fs.readFileSync(new URL("../scripts/run-approved-statewide-logo-bootstrap.sh", import.meta.url), "utf8");
  assert.match(source, /\{\"limit\":25\}/);
  assert.match(source, /limit:8/);
  assert.match(source, /randomBytes\(32\)/, "execution token must be freshly generated at runtime");
  assert.match(source, /localbleachersar-logo-bootstrap-exec/, "execution must use the dedicated temporary sibling Worker");
  assert.match(source, /_logo-bootstrap-exec\.mjs/, "temporary Worker must use a generated execution wrapper");
  assert.match(source, /LOGO_BOOTSTRAP_TOKEN/, "temporary wrapper must inject the dedicated logo execution token");
  assert.match(source, /wrangler deploy --config "\$TEMP_CONFIG"/, "temporary Worker must deploy through native Wrangler");
  assert.match(source, /wrangler delete --config "\$TEMP_CONFIG"/, "failure cleanup must delete the temporary Worker");
  assert.match(source, /logo-bootstrap-result/, "final result must be published without a second D1 read");
  assert.match(source, /LOGO_BOOTSTRAP_READY/, "execution must prove readiness before logo writes");
  assert.doesNotMatch(source, /wrangler secret put LOGO_BOOTSTRAP_TOKEN|wrangler secret delete LOGO_BOOTSTRAP_TOKEN/);
  assert.equal((source.match(/wrangler d1 execute/g) || []).length, 1, "must perform exactly one remote D1 verification");
  assert.doesNotMatch(source, /migrations apply|db:migrate|reconcile|collection|refresh-all/i);
  for (const id of ["df-2tng4g","df-cc7dyc","df-abs2rr","df-qscp6x","df-urlzfa","df-25lkrp"]) {
    assert.match(source, new RegExp(id));
  }
  for (const id of ["uark","arkansas-state","uapb","uca","little-rock","ecclesia"]) {
    assert.match(source, new RegExp(`\\b${id}\\b`));
  }
  assert.match(source, /total===336/);
  assert.match(source, /high===300/);
  assert.match(source, /college===36/);
});
