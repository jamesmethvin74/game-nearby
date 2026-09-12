import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cacheDescriptor, COVERAGE_CACHE_VERSION } from "../src/public-cors-worker.js";

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
  assert.match(source, /legacyKey:/);
  assert.match(source, /freshTtl/);
  assert.match(source, /staleTtl/);
  assert.match(source, /putCached\(cache, descriptor\.freshKey/);
  assert.match(source, /putCached\(cache, descriptor\.staleKey/);
  assert.match(source, /staleRead\(cache, descriptor, request\)/);
});

test("quota fallback can use pre-migration last-good cache entries", () => {
  assert.match(source, /readCached\(cache, descriptor\.legacyKey/);
  assert.match(source, /source: "legacy-last-good"/);
});

test("nearby cache keys preserve location and coarse date window", () => {
  assert.match(source, /const lat = rounded/);
  assert.match(source, /const lon = rounded/);
  assert.match(source, /const radius = rounded/);
  assert.match(source, /const since = dateBucket/);
  assert.match(source, /const until = dateBucket/);
  assert.match(source, /lat=\$\{lat\}&lon=\$\{lon\}&radius=\$\{radius\}&since=\$\{since\}&until=\$\{until\}/);
  assert.match(source, /legacyQuery = `lat=\$\{lat\}&lon=\$\{lon\}&radius=\$\{radius\}`/);
});

test("diagnostic requests bypass the public cache", () => {
  assert.match(source, /x-localbleachers-debug/);
  assert.match(source, /x-localbleachers-diagnostic/);
  assert.match(source, /return null/);
});

test("school-level schedule reads are edge-cached without extra D1 fanout", () => {
  const descriptor = cacheDescriptor(new Request("https://example.test/api/v1/schools/uca/schedule"));
  assert.ok(descriptor);
  assert.equal(descriptor.freshTtl, 15 * 60);
  assert.equal(descriptor.staleTtl, 24 * 60 * 60);
  assert.equal(new URL(descriptor.freshKey.url).pathname, "/__localbleachers_cache__/fresh/api/v1/schools/uca/schedule");
});

test("truthful coverage cache is versioned away from false missing-team payloads", () => {
  assert.equal(COVERAGE_CACHE_VERSION, "truthful-v4");
  const full = cacheDescriptor(new Request("https://example.test/api/v1/coverage-report"));
  const exceptions = cacheDescriptor(new Request("https://example.test/api/v1/coverage-report?view=exceptions"));
  assert.ok(full);
  assert.ok(exceptions);
  assert.notEqual(full.freshKey.url, exceptions.freshKey.url);
  assert.match(full.freshKey.url, /coverage-report\/truthful-v4/);
  assert.doesNotMatch(full.freshKey.url, /truthful-v3/);
  assert.doesNotMatch(full.freshKey.url, /truthful-v2/);
  assert.doesNotMatch(full.freshKey.url, /fresh\/coverage-report$/);
  assert.equal(full.freshTtl, 60 * 60);
  assert.equal(full.staleTtl, 24 * 60 * 60);
});

test("high-churn reads use short fresh TTLs", () => {
  assert.match(source, /\/games\?\$\{query\}`, 5 \* 60/);
  assert.match(source, /kind === "record" \? 5 \* 60/);
  assert.match(source, /kind === "schedule" \? 15 \* 60/);
});
