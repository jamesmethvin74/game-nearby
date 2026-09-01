import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../../service-worker.js", import.meta.url), "utf8");
const logos = await readFile(new URL("../../school-logo-ui.js", import.meta.url), "utf8");
const liveData = await readFile(new URL("../../live-data.js", import.meta.url), "utf8");
const polish = await readFile(new URL("../../polish.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const branding = await readFile(new URL("../src/school-branding.js", import.meta.url), "utf8");

test("v54 keeps the mascot-logo frontend and restores card records", () => {
  assert.match(html, /polish\.js\?v=54/);
  assert.match(html, /team-detail\.js\?v=49/);
  assert.match(html, /live-data\.js\?v=54/);
  assert.match(html, /school-logo-ui\.js\?v=50/);
  assert.match(html, /href="standings\.html"/);
  assert.match(sw, /localbleachersar-shell-v54/);
  assert.match(sw, /school-logo-ui\.js/);
  assert.match(sw, /standings\.html/);
  assert.match(logos, /school-mascot-logo/);
  assert.match(logos, /team-choice-logo/);
  assert.match(logos, /badgeFor = badgeMarkup/);
  assert.match(logos, /LocalBleachersSchoolLogos/);
  assert.match(liveData, /localBleachersAR:recordCache:v1/);
  assert.match(liveData, /fetchPublishedRecord/);
  assert.match(liveData, /getRecordForEvent/);
  assert.match(liveData, /refreshRecordsForEvents/);
  assert.match(polish, /LocalBleachersLive\.getRecordForEvent/);
});

test("branding backend populates schools and exposes unmatched cleanup report", () => {
  assert.match(branding, /school_brand_assets/);
  assert.match(branding, /logo_url=COALESCE/);
  assert.match(branding, /mascot=COALESCE/);
  assert.match(branding, /getSchoolBrandingReport/);
  assert.match(branding, /unmatchedLogoSchools/);
  assert.match(branding, /status!='curated'/);
  assert.match(worker, /\/api\/v1\/branding\/report/);
  assert.match(worker, /enrichMaxPrepsSchoolMascots/);
});
