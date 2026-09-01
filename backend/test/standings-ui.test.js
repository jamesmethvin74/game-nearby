import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../standings.html", import.meta.url), "utf8");
const js = await readFile(new URL("../../standings.js", import.meta.url), "utf8");
const home = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../../service-worker.js", import.meta.url), "utf8");
const wrapper = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");

test("Standings page exposes sport and conference selectors and a live standings table", () => {
  assert.match(html, /id="standingsSport"/);
  assert.match(html, /id="standingsConference"/);
  assert.match(html, /id="standingsBody"/);
  assert.match(html, />Conference</);
  assert.match(html, />Overall</);
});

test("Standings UI loads options and standings from the public API", () => {
  assert.match(js, /\/api\/v1\/standings\/options\?sport=/);
  assert.match(js, /\/api\/v1\/standings\?sport=/);
  assert.match(wrapper, /\/api\/v1\/standings\/options/);
  assert.match(wrapper, /\/api\/v1\/standings/);
});

test("Home navigation and PWA shell include Standings", () => {
  assert.match(home, /href="standings\.html"[^>]*>[^<]*<span>Standings<\/span>/);
  assert.match(serviceWorker, /localbleachersar-shell-v51/);
  assert.match(serviceWorker, /\.\/standings\.html/);
  assert.match(serviceWorker, /\.\/standings\.js/);
  assert.match(serviceWorker, /\.\/standings\.css/);
});

test("Standings page identifies the published official Arkansas source", () => {
  assert.match(html, /Arkansas Activities Association scores and statistics partner/);
  assert.match(html, />MaxPreps<\/a>/);
});
