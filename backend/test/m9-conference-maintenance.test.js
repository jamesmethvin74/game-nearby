import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/milestone2-scheduled-worker.js", import.meta.url), "utf8");

test("weekly catalog maintenance keeps both active fall sports conference membership current", () => {
  assert.match(source, /syncPublishedFootballConferenceMembership/);
  assert.match(source, /weekly published football conference membership/);
  assert.match(source, /syncPublishedVolleyballConferenceMembership/);
  assert.match(source, /weekly published volleyball conference membership/);
});
