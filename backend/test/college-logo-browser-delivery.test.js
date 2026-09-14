import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const logoUi = await readFile(new URL("../../school-logo-ui.js", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../../service-worker.js", import.meta.url), "utf8");

test("college logos trust the API delivery URL instead of reproxying in the browser", () => {
  assert.doesNotMatch(logoUi, /images\.weserv\.nl/);
  assert.doesNotMatch(logoUi, /collegeLogoUrl/);
  assert.match(logoUi, /const sourceLogoUrl = safeLogoUrl\(raw\.logo_url\)/);
  assert.match(logoUi, /logoUrl: sourceLogoUrl/);
  assert.match(logoUi, /sourceLogoUrl,/);
});

test("PWA shell version changes so installed apps receive the verified logo-delivery code", () => {
  assert.match(serviceWorker, /localbleachersar-shell-v65/);
  assert.match(serviceWorker, /"\.\/school-logo-ui\.js"/);
});