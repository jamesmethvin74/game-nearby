import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");

test("nearby games query quotes the rank alias for Cloudflare D1", () => {
  assert.match(worker, /NULL AS "rank"/);
  assert.doesNotMatch(worker, /NULL AS rank\b/);
});
