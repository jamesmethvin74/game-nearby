import test from "node:test";
import assert from "node:assert/strict";
import { parseMaxPrepsSchoolDirectory, parseMaxPrepsSchoolPage, matchMaxPrepsBranding, normalizeMaxPrepsLogoUrl } from "../src/school-branding.js";

test("directory parser keeps each logo attached to its own school anchor", () => {
  const html = `
    <a title="Valley Springs" href="/m/team/default.aspx?allseasonid=x&amp;schoolid=e6395067-8dff-4d9b-9563-29b5e2a8af70">
      <img src="https://image.maxpreps.io/school-mascot/e/6/3/e6395067-8dff-4d9b-9563-29b5e2a8af70.gif?version=1&amp;width=64&amp;height=64" />
      <div><div class="title">Valley Springs</div><div class="description">Valley Springs, AR</div></div>
    </a>
    <a title="Conway" href="/m/team/default.aspx?allseasonid=x&amp;schoolid=ad9a06b1-01d1-4f23-a4d1-879e8d7f80a7">
      <img src="https://image.maxpreps.io/school-mascot/a/d/9/ad9a06b1-01d1-4f23-a4d1-879e8d7f80a7.gif?version=2&amp;width=64&amp;height=64" />
      <div><div class="title">Conway</div><div class="description">Conway, AR</div></div>
    </a>`;
  const rows = parseMaxPrepsSchoolDirectory(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Valley Springs");
  assert.equal(rows[0].externalSchoolId, "e6395067-8dff-4d9b-9563-29b5e2a8af70");
  assert.match(rows[0].logoUrl, /e6395067/);
  assert.equal(rows[1].name, "Conway");
  assert.match(rows[1].logoUrl, /ad9a06b1/);
});

test("logo URL is normalized to a useful card resolution", () => {
  const url = normalizeMaxPrepsLogoUrl("https://image.maxpreps.io/school-mascot/a/b/c/test.gif?width=64&height=64", 256);
  assert.match(url, /width=256/);
  assert.match(url, /height=256/);
});

test("school page parser extracts mascot and colors", () => {
  const page = `<dl><dt>Mascot</dt><dd>Tigers</dd><dt>Colors</dt><dd><span style="background-color:#00824B"></span><span style="background-color:#FFFFFF"></span></dd></dl>`;
  assert.deepEqual(parseMaxPrepsSchoolPage(page), { mascot:"Tigers", primaryColor:"#00824B", secondaryColor:"#FFFFFF" });
});

test("matcher uses authoritative name plus city and refuses ambiguous duplicate names", () => {
  const schools = [
    {id:"valley",name:"VALLEY SPRINGS HIGH SCHOOL",location_matched_name:"Valley Springs High School",city:"Valley Springs"},
    {id:"lakeside-hot-springs",name:"Lakeside High School",location_matched_name:"Lakeside High School",city:"Hot Springs"},
    {id:"lakeside-lake-village",name:"Lakeside High School",location_matched_name:"Lakeside High School",city:"Lake Village"}
  ];
  const entries = [
    {externalSchoolId:"v",name:"Valley Springs",city:"Valley Springs",logoUrl:"https://image.maxpreps.io/school-mascot/v.gif",sourceUrl:"v"},
    {externalSchoolId:"h",name:"Lakeside",city:"Hot Springs",logoUrl:"https://image.maxpreps.io/school-mascot/h.gif",sourceUrl:"h"},
    {externalSchoolId:"x",name:"Lakeside",city:"",logoUrl:"https://image.maxpreps.io/school-mascot/x.gif",sourceUrl:"x"}
  ];
  const result = matchMaxPrepsBranding(entries, schools, []);
  assert.equal(result.matches.find(row => row.schoolId === "valley")?.entry.externalSchoolId, "v");
  assert.equal(result.matches.find(row => row.schoolId === "lakeside-hot-springs")?.entry.externalSchoolId, "h");
  assert.ok(result.ambiguous.some(row => row.entry.externalSchoolId === "x"));
});
