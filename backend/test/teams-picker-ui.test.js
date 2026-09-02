import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../../teams.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../../teams-page.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../teams-page.css", import.meta.url), "utf8");
const catalog = await readFile(new URL("../../teams-catalog-bootstrap.js", import.meta.url), "utf8");

test("Teams picker does not truncate or hide schools from the statewide list", () => {
  assert.doesNotMatch(ui, /\.slice\(0\s*,\s*40\)/);
  assert.doesNotMatch(ui, /\.filter\(school => !followed\.includes\(school\.id\)\)/);
  assert.match(ui, /function filteredSchools\(\)/);
  assert.match(ui, /school-result-follow/);
  assert.match(ui, /data-follow-id/);
  assert.match(ui, /is-following/);
});

test("Teams picker opens a modal sheet with its own visible search box", () => {
  assert.match(page, /<dialog id="schoolPickerDialog"/);
  assert.match(page, /id="schoolPickerSearch"/);
  assert.match(page, /id="schoolPickerTrigger"/);
  assert.match(ui, /pickerDialog\.showModal\(\)/);
  assert.match(css, /\.school-picker-dialog::backdrop/);
  assert.match(css, /grid-template-rows:auto auto minmax\(0,1fr\)/);
  assert.match(css, /\.school-search-results\{[^}]*overflow-y:auto/);
  assert.match(css, /overscroll-behavior:contain/);
  assert.match(css, /touch-action:pan-y/);
});

test("college picker has an explicit supported college source independent of high-school refresh", () => {
  assert.match(catalog, /const COLLEGE_SCHOOLS = \[/);
  assert.match(catalog, /University of Central Arkansas/);
  assert.match(catalog, /Hendrix College/);
  assert.match(catalog, /Central Baptist College/);
  assert.match(catalog, /getColleges: \(\) => COLLEGE_SCHOOLS\.map\(normalizeSchool\)/);
  assert.match(ui, /const FALLBACK_COLLEGES = \[/);
  assert.match(ui, /function supportedColleges\(\)/);
  assert.match(ui, /getColleges/);
  assert.match(ui, /level:"college"/);
});
