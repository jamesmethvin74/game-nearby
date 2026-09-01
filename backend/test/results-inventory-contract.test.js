import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");

test("statewide ingestion and worker startup both rebuild persistent result records", () => {
  assert.match(statewide, /rebuildStatewideRecords/);
  assert.match(worker, /await rebuildStatewideRecords\(env,now\)/);
});
