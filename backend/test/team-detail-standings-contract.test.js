import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const detail = await readFile(new URL("../../team-detail.js", import.meta.url), "utf8");
const standingsHtml = await readFile(new URL("../../standings.html", import.meta.url), "utf8");

test("team detail resolves standing from the same public conference table as Standings", () => {
  assert.match(detail, /\/api\/v1\/standings\?sport=/);
  assert.match(detail, /standingRowFor\(payload, seed\)/);
  assert.match(detail, /overall:\s*row\.overall_record\s*\|\|\s*status\.overall/);
  assert.match(detail, /conference:\s*row\.conference_record\s*\|\|\s*status\.conference/);
  assert.match(detail, /standing:\s*Number\.isFinite\(rank\).*`#\$\{rank\}`/s);
});

test("team detail normalizes sport-suffixed local conference ids to published standings ids", () => {
  assert.match(detail, /publishedConferenceId/);
  assert.match(detail, /conference_id/);
  assert.match(detail, /new RegExp\(`-\$\{String\(sport/);
});

test("standings page does not present request retrieval time as an update timestamp", () => {
  assert.match(standingsHtml, /id="standingsUpdated"[^>]*hidden[^>]*aria-hidden="true"/);
});
