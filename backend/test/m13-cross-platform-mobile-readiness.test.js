import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
const pageNames = ["index.html", "teams.html", "standings.html", "live-scores.html"];
const pages = new Map(await Promise.all(pageNames.map(async name => [
  name,
  await readFile(new URL(name, ROOT), "utf8")
])));
const manifest = JSON.parse(await readFile(new URL("manifest.json", ROOT), "utf8"));
const mobileCss = await readFile(new URL("mobile-platform.css", ROOT), "utf8");
const serviceWorker = await readFile(new URL("service-worker.js", ROOT), "utf8");

const expectedNavLabels = ["Home", "Teams", "Standings", "Alerts", "Scores"];

function bottomNav(html) {
  const match = html.match(/<nav class="bottom-nav[^"]*"[\s\S]*?<\/nav>/);
  assert.ok(match, "page must contain the primary bottom navigation");
  return match[0];
}

test("all production app screens expose the same Android and Apple install shell", () => {
  for (const [name, html] of pages) {
    assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/, `${name} must opt into safe-area viewport rendering`);
    assert.match(html, /name="theme-color" content="#071426"/, `${name} must expose the shared theme color`);
    assert.match(html, /name="mobile-web-app-capable" content="yes"/, `${name} must remain install-capable on Chromium/Android`);
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/, `${name} must remain install-capable on Apple mobile Safari`);
    assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/, `${name} must declare the Apple standalone status-bar treatment`);
    assert.match(html, /name="apple-mobile-web-app-title" content="LocalBleachersAR"/, `${name} must expose the Apple home-screen title`);
    assert.match(html, /rel="manifest" href="manifest\.json\?v=71"/, `${name} must load the current install manifest`);
    assert.match(html, /rel="apple-touch-icon" href="assets\/app-icon-192-v35\.png"/, `${name} must expose an Apple home-screen icon`);
    assert.match(html, /rel="stylesheet" href="mobile-platform\.css\?v=71"/, `${name} must load shared cross-platform mobile safeguards`);
  }
});

test("the installed app supports both portrait and landscape instead of forcing one platform posture", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, undefined);
  assert.equal(manifest.start_url, "/game-nearby/?source=pwa-v71");
  assert.equal(manifest.scope, "/game-nearby/");
  assert.ok(manifest.icons.some(icon => icon.purpose === "any" && icon.sizes === "512x512"));
  assert.ok(manifest.icons.some(icon => icon.purpose === "maskable"));
});

test("safe-area and dynamic viewport handling covers notches, home indicators, and landscape edges", () => {
  for (const edge of ["top", "right", "bottom", "left"]) {
    assert.match(mobileCss, new RegExp(`safe-area-inset-${edge}`));
  }
  assert.match(mobileCss, /min-height:\s*100dvh/);
  assert.match(mobileCss, /\.app-header\.branded-header[\s\S]*var\(--safe-top\)/);
  assert.match(mobileCss, /\.bottom-nav[\s\S]*var\(--safe-bottom\)/);
  assert.match(mobileCss, /\.school-picker-dialog[\s\S]*var\(--safe-left\)[\s\S]*var\(--safe-right\)/);
  assert.match(mobileCss, /\.standings-picker-sheet[\s\S]*var\(--safe-left\)[\s\S]*var\(--safe-right\)/);
});

test("coarse-pointer controls retain a shared minimum mobile touch target", () => {
  assert.match(mobileCss, /@media \(pointer:\s*coarse\)/);
  const fortyFourCount = (mobileCss.match(/44px/g) || []).length;
  assert.ok(fortyFourCount >= 3, "mobile controls should enforce 44px touch targets across multiple control groups");
});

test("primary navigation stays in one order on every app screen", () => {
  for (const [name, html] of pages) {
    const nav = bottomNav(html);
    const labels = [...nav.matchAll(/<span>(Home|Teams|Standings|Alerts|Scores)<\/span>/g)].map(match => match[1]);
    assert.deepEqual(labels, expectedNavLabels, `${name} must preserve the shared five-tab order`);
    assert.doesNotMatch(nav, /<span>More<\/span>/, `${name} must not replace a primary destination with an ambiguous More tab`);
  }
});

test("service worker advances and precaches the cross-platform shell", () => {
  assert.match(serviceWorker, /localbleachersar-shell-v71/);
  assert.match(serviceWorker, /"\.\/mobile-platform\.css"/);
  for (const page of pageNames) {
    const asset = page === "index.html" ? "./index.html" : `./${page}`;
    assert.ok(serviceWorker.includes(`"${asset}"`), `${page} must stay in the offline app shell`);
  }
});
