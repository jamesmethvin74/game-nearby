import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../teams-catalog-bootstrap.js", import.meta.url), "utf8");
const start = source.indexOf("const COLLEGE_SCHOOLS = [");
const end = source.indexOf("\n  ];", start);
assert.ok(start >= 0 && end > start, "COLLEGE_SCHOOLS catalog not found");
const catalog = source.slice(start, end);

const ids = [...catalog.matchAll(/\{ id:"([^"]+)"/g)].map(match => match[1]);

test("Teams catalog contains the 35 supported Arkansas intercollegiate athletics programs", () => {
  assert.equal(ids.length, 35);
  assert.equal(new Set(ids).size, 35, "college ids must be unique");
  assert.ok(!ids.includes("asu-three-rivers"), "ASU Three Rivers has no supported LocalBleachersAR sport and must stay excluded");
});

test("college catalog spans NCAA, NAIA, NJCAA, and NCCAA programs", () => {
  for (const id of [
    "uark", "arkansas-state", "uapb", "uca", "little-rock",
    "arkansas-tech", "uafs", "uam", "harding", "henderson-state", "ouachita-baptist", "southern-arkansas",
    "hendrix", "lyon", "ozarks",
    "arkansas-baptist", "cbc", "crowleys-ridge", "john-brown", "philander-smith", "williams-baptist",
    "asu-mid-south", "asu-mountain-home", "asu-newport", "national-park", "north-arkansas", "nwacc", "shorter", "south-arkansas", "seark", "sau-tech", "ua-rich-mountain", "ua-cossatot",
    "champion-christian", "ecclesia"
  ]) assert.ok(ids.includes(id), `missing Arkansas college ${id}`);
});

test("current institution names are used for renamed Arkansas programs", () => {
  assert.match(catalog, /Philander Smith University/);
  assert.match(catalog, /South Arkansas College/);
  assert.match(catalog, /NorthWest Arkansas Community College/);
});