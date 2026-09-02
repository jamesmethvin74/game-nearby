import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../../teams.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../../teams-page.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../teams-page.css", import.meta.url), "utf8");
const catalog = await readFile(new URL("../../teams-catalog-bootstrap.js", import.meta.url), "utf8");

test("Teams picker does not truncate the statewide school list", () => {
  assert.doesNotMatch(ui, /\.slice\(0\s*,\s*40\)/);
  assert.match(ui, /function filteredSchools\(\)/);
  assert.match(ui, /school-result-follow/);
  assert.match(ui, /data-follow-id/);
  assert.doesNotMatch(page, /id="followSchoolBtn"/);
});

test("Teams picker traps scrolling inside the open school list", () => {
  assert.match(ui, /school-picker-open/);
  assert.match(css, /overscroll-behavior:contain/);
  assert.match(css, /html\.school-picker-open,body\.school-picker-open\{overflow:hidden/);
  assert.match(css, /touch-action:pan-y/);
});

test("live high-school refresh preserves supported colleges", () => {
  assert.match(catalog, /const COLLEGE_SCHOOLS = \[/);
  assert.match(catalog, /University of Central Arkansas/);
  assert.match(catalog, /Hendrix College/);
  assert.match(catalog, /Central Baptist College/);
  assert.match(catalog, /function withSupportedColleges\(schools\)/);
  assert.match(catalog, /for \(const school of COLLEGE_SCHOOLS\)/);
});
