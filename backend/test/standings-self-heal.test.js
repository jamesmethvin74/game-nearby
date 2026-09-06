import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("standings recovery is bounded to the selected local conference cohort", async () => {
  const source = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");
  assert.match(source, /import \{ rebuildTeamRecords \} from "\.\/record-rebuild\.js"/);
  assert.match(source, /t\.conference_id=\?/);
  assert.match(source, /t\.sport=\?/);
  assert.match(source, /t\.season=\?/);
  assert.match(source, /s\.catalog_scope='local'/);
  assert.match(source, /if \(!calculated\) \{\s*calculated = await rebuildMissingCalculatedConference/s);
  assert.doesNotMatch(source, /rebuildStatewideRecords/);
});
