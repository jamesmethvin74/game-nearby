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

test("standings favorites support long-press touch drag reorder and persist the custom order", async () => {
  const drag = await read("standings-drag-reorder.js");
  const css = await read("standings-favorites.css");
  const html = await read("standings.html");

  assert.match(drag, /const LONG_PRESS_MS = 340/);
  assert.match(drag, /addEventListener\("touchstart"/);
  assert.match(drag, /addEventListener\("touchmove"/);
  assert.match(drag, /event\.preventDefault\(\)/);
  assert.match(drag, /grid\.insertBefore\(gesture\.card, reference\)/);
  assert.match(drag, /localStorage\.setItem\(FAVORITES_KEY, JSON\.stringify\(ordered\)\)/);
  assert.match(drag, /new StorageEvent\("storage"/);
  assert.match(css, /\.favorite-standings-move \{\s*display: none;/);
  assert.match(css, /\.favorite-standings-drag-ghost/);
  assert.match(css, /\.favorite-standings-card\.is-drag-placeholder/);
  assert.match(html, /Hold and drag a card to reorder\./);
});

test("standings preference release advances the PWA shell without dropping live scores", async () => {
  const html = await read("standings.html");
  const sw = await read("service-worker.js");

  assert.match(html, /standings\.js\?v=66/);
  assert.match(html, /standings-drag-reorder\.js\?v=66/);
  assert.match(html, /standings-favorites\.css\?v=66/);
  assert.match(sw, /localbleachersar-shell-v66/);
  assert.match(sw, /\.\/standings-drag-reorder\.js/);
  assert.match(sw, /\.\/standings-favorites\.css/);
  assert.match(sw, /\.\/live-scores\.html/);
  assert.match(sw, /\.\/live-scores\.js/);
});
