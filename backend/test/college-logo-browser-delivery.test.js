import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const logoUi = await readFile(new URL("../../school-logo-ui.js", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../../service-worker.js", import.meta.url), "utf8");
const publicCors = await readFile(new URL("../src/public-cors-worker.js", import.meta.url), "utf8");

test("college logos render the backend-provided same-origin relay URL without a second browser proxy", () => {
  assert.doesNotMatch(logoUi, /images\.weserv\.nl/);
  assert.match(logoUi, /function collegeLogoUrl\(value\) \{\s*return safeLogoUrl\(value\);\s*\}/);
  assert.match(logoUi, /const sourceLogoUrl = safeLogoUrl\(raw\.logo_url\)/);
  assert.match(logoUi, /logoUrl: sourceLogoUrl/);
  assert.match(publicCors, /logo-render-v8-relay-authoritative/);
  assert.match(publicCors, /same-origin-relay-v4/);
  assert.doesNotMatch(publicCors, /DIRECT_LOGO_OVERRIDES/);
});

test("PWA shell version changes so installed apps receive relay-authoritative logo code", () => {
  assert.match(serviceWorker, /localbleachersar-shell-v65/);
  assert.match(serviceWorker, /"\.\/school-logo-ui\.js"/);
});
