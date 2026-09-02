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

test("public GET CORS wrapper remains outside the read path", () => {
  assert.match(corsWorker, /access-control-allow-origin", "\*"/);
  assert.match(corsWorker, /x-localbleachers-api-cors", "public-get-v1"/);
  assert.match(corsWorker, /const response = await app\.fetch\(request, env, ctx\)/);
});
