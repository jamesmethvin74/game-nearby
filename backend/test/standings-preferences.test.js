import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function read(name) {
  return readFile(new URL(name, root), "utf8");
}

test("standings defaults to football and persists the last viewed sport/conference", async () => {
  const js = await read("standings.js");
  const html = await read("standings.html");

  assert.match(js, /const DEFAULT_SPORT = "football"/);
  assert.match(js, /localBleachersAR:standings:lastSport/);
  assert.match(js, /localBleachersAR:standings:lastConferenceBySport/);
  assert.match(js, /localStorage\.setItem\(LAST_SPORT_KEY, selectedSport\)/);
  assert.match(js, /\[selectedSport\]: selectedConference/);
  assert.match(html, /data-value="football"/);
  assert.match(html, /id="standingsSportValue">Football</);
});

test("standings supports persisted sport+conference favorites below the live card", async () => {
  const js = await read("standings.js");
  const html = await read("standings.html");

  assert.match(js, /localBleachersAR:standings:favorites/);
  assert.match(js, /standingsFavoriteToggle/);
  assert.match(js, /favoriteStandingsGrid/);
  assert.match(js, /toggleCurrentFavorite/);
  assert.match(js, /openFavorite/);
  assert.match(html, /id="standingsFavoriteToggle"/);
  assert.match(html, /id="favoriteStandingsTitle">My Standings</);
  assert.match(html, /id="favoriteStandingsGrid"/);
});

test("standings preference release busts the PWA shell cache", async () => {
  const html = await read("standings.html");
  const sw = await read("service-worker.js");

  assert.match(html, /standings\.js\?v=60/);
  assert.match(html, /standings-favorites\.css\?v=60/);
  assert.match(sw, /localbleachersar-shell-v60/);
  assert.match(sw, /\.\/standings-favorites\.css/);
});
