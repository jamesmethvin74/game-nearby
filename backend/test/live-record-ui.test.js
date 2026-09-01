import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../../service-worker.js", import.meta.url), "utf8");

test("v49 forces installed clients onto the live-record frontend", () => {
  assert.match(html, /polish\.js\?v=49/);
  assert.match(html, /team-detail\.js\?v=49/);
  assert.match(html, /live-data\.js\?v=49/);
  assert.match(sw, /localbleachersar-shell-v49/);
});
