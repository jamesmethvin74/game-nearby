import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const logoUi = await readFile(new URL("../../school-logo-ui.js", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../../service-worker.js", import.meta.url), "utf8");

test("college logos use browser-side image delivery while high-school logos remain direct", () => {
  assert.match(logoUi, /const COLLEGE_LOGO_PROXY_ORIGIN = "https:\/\/images\.weserv\.nl\/"/);
  assert.match(logoUi, /function collegeLogoUrl\(value\)/);
  assert.match(logoUi, /const level = clean\(raw\.level\) === "college" \? "college" : "high-school"/);
  assert.match(logoUi, /const sourceLogoUrl = safeLogoUrl\(raw\.logo_url\)/);
  assert.match(logoUi, /logoUrl: level === "college" \? collegeLogoUrl\(sourceLogoUrl\) : sourceLogoUrl/);
  assert.match(logoUi, /proxy\.searchParams\.set\("fit", "contain"\)/);
  assert.match(logoUi, /proxy\.searchParams\.set\("output", "png"\)/);
  assert.match(logoUi, /proxy\.searchParams\.set\("n", "-1"\)/);
});

test("PWA shell version changes so installed apps receive the logo-delivery code", () => {
  assert.match(serviceWorker, /localbleachersar-shell-v64/);
  assert.match(serviceWorker, /"\.\/school-logo-ui\.js"/);
});
