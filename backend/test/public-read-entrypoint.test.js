import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const standingsWorker = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");
const corsWorker = await readFile(new URL("../src/public-cors-worker.js", import.meta.url), "utf8");

test("public API entrypoint never runs schema maintenance on GET requests", () => {
  assert.doesNotMatch(standingsWorker, /ensureStatewideSchema/);
  assert.doesNotMatch(standingsWorker, /needsStatewideSchema/);
  assert.match(standingsWorker, /return app\.fetch\(request, env, ctx\)/);
});

test("public read wrapper keeps CORS and last-good fallback outside the D1 route", () => {
  assert.match(corsWorker, /access-control-allow-origin", "\*"/);
  assert.match(corsWorker, /const CORS_MARKER = "public-get-v3"/);
  assert.match(corsWorker, /const RELEASE = "public-read-resilient-v3"/);
  assert.match(corsWorker, /x-localbleachers-api-stale/);
  assert.match(corsWorker, /x-localbleachers-cache-source/);
  assert.match(corsWorker, /cacheDescriptor\(request\)/);
  assert.match(corsWorker, /response\.status >= 500/);
  assert.match(corsWorker, /staleRead\(cache, descriptor, request\)/);
});
