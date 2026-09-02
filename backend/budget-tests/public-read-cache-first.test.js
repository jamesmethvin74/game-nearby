import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/public-cors-worker.js", import.meta.url),
  "utf8"
);

test("fresh edge cache is consulted before the D1-backed app", () => {
  const freshRead = source.indexOf("readCached(cache, descriptor.freshKey, request)");
  const appRead = source.indexOf("await app.fetch(request, env, ctx)");
  assert.ok(freshRead >= 0, "fresh edge-cache lookup is missing");
  assert.ok(appRead >= 0, "D1-backed app call is missing");
  assert.ok(freshRead < appRead, "D1 is called before the fresh edge cache");
  assert.match(source, /if \(fresh\) return fresh/);
});

test("fresh and last-good cache lifetimes are separate", () => {
  assert.match(source, /freshKey:/);
  assert.match(source, /staleKey:/);
  assert.match(source, /freshTtl/);
  assert.match(source, /staleTtl/);
  assert.match(source, /putCached\(cache, descriptor\.freshKey/);
  assert.match(source, /putCached\(cache, descriptor\.staleKey/);
  assert.match(source, /staleRead\(cache, descriptor, request\)/);
});

test("nearby cache keys preserve location and coarse date window", () => {
  assert.match(source, /const lat = rounded/);
  assert.match(source, /const lon = rounded/);
  assert.match(source, /const radius = rounded/);
  assert.match(source, /const since = dateBucket/);
  assert.match(source, /const until = dateBucket/);
  assert.match(source, /lat=\$\{lat\}&lon=\$\{lon\}&radius=\$\{radius\}&since=\$\{since\}&until=\$\{until\}/);
});

test("diagnostic requests bypass the public cache", () => {
  assert.match(source, /x-localbleachers-debug/);
  assert.match(source, /x-localbleachers-diagnostic/);
  assert.match(source, /return null/);
});

test("high-churn reads use short fresh TTLs", () => {
  assert.match(source, /\/games\?\$\{query\}`, 5 \* 60/);
  assert.match(source, /kind === "record" \? 5 \* 60/);
  assert.match(source, /kind === "schedule" \? 15 \* 60/);
});
