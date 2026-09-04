import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../school-follow-logic.js", import.meta.url), "utf8");
const liveData = fs.readFileSync(new URL("../../live-data.js", import.meta.url), "utf8");

test("M4 team follow UI exposes an explicit High School / College picker", () => {
  assert.match(source, /id="teamLevelFilter"/);
  assert.match(source, /value="high-school"/);
  assert.match(source, /value="college"/);
  assert.match(source, /data-team-level=/);
  assert.match(source, /school\.level === "college"/);
});

test("M4 team picker preserves the existing followed-school IDs rather than inventing college-specific follow storage", () => {
  assert.match(source, /followed\.includes\(school\.id\)/);
  assert.match(source, /input type="checkbox" value="\$\{school\.id\}"/);
  assert.doesNotMatch(source, /collegeFollowed|highSchoolFollowed/);
});

test("live catalog normalization already carries backend school level into the picker", () => {
  assert.match(liveData, /level: String\(school\.level \|\| "high-school"\)/);
});
