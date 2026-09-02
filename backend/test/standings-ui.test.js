import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../standings.html", import.meta.url), "utf8");
const js = await readFile(new URL("../../standings.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../standings.css", import.meta.url), "utf8");
const home = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../../service-worker.js", import.meta.url), "utf8");
const wrapper = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");

test("Standings page uses custom sport and conference pickers instead of native selects", () => {
  assert.match(html, /id="standingsSportTrigger"/);
  assert.match(html, /id="standingsConferenceTrigger"/);
  assert.match(html, /id="standingsPickerDialog"/);
  assert.match(html, /id="standingsPickerOptions"/);
  assert.doesNotMatch(html, /<select\b/i);
  assert.match(js, /openPicker\("sport"\)/);
  assert.match(js, /openPicker\("conference"\)/);
  assert.match(js, /showModal\(\)/);
});

test("Standings page keeps live conference and overall records visible on phones", () => {
  assert.match(html, /id="standingsBody"/);
  assert.match(html, />Conf\.<\/th>/);
  assert.match(html, />Overall<\/th>/);
  assert.match(css, /table-layout:\s*fixed/);
  assert.doesNotMatch(css, /min-width:\s*500px/);
  assert.match(css, /\.standings-table \.pct-col\s*\{\s*display:\s*none/);
});

test("Standings UI loads options and standings from the public API", () => {
  assert.match(js, /\/api\/v1\/standings\/options\?sport=/);
  assert.match(js, /\/api\/v1\/standings\?sport=/);
  assert.match(wrapper, /\/api\/v1\/standings\/options/);
  assert.match(wrapper, /\/api\/v1\/standings/);
  assert.match(wrapper, /reconcileFootballOverallRecords/);
});

test("Home navigation and PWA shell include reconciled Standings v55", () => {
  assert.match(home, /href="standings\.html"[^>]*>[^<]*<span>Standings<\/span>/);
  assert.match(serviceWorker, /localbleachersar-shell-v55/);
  assert.match(serviceWorker, /\.\/standings\.html/);
  assert.match(serviceWorker, /\.\/standings\.js/);
  assert.match(serviceWorker, /\.\/standings\.css/);
});

test("Standings page identifies both published standings and football cross-check source", () => {
  assert.match(html, />MaxPreps<\/a>/);
  assert.match(html, /football 0-0 records are cross-checked with/);
  assert.match(html, />Fearless Friday<\/a>/);
});
