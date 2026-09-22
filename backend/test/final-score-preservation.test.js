import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const statewide = await readFile(new URL("../src/dragonfly-statewide.js", import.meta.url), "utf8");
const core = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const resolvedWriter = await readFile(new URL("../src/canonical-observation-writer.js", import.meta.url), "utf8");

test("statewide ingestion retains final scores needed for results and records", () => {
  assert.match(statewide, /teamScore/);
  assert.match(statewide, /opponentScore/);
  assert.match(statewide, /home_score/);
  assert.match(statewide, /away_score/);
  assert.match(statewide, /conference_game:[^\n]+,status,/);
  assert.match(statewide, /home_score:status===\"FINAL\"\?homeScore:null/);
  assert.match(statewide, /away_score:status===\"FINAL\"\?awayScore:null/);
});


test("normal refreshes preserve a previously complete final when later source data is incomplete",()=>{
  for(const source of [statewide,core,resolvedWriter]){
    assert.match(source,/excluded\.team_score IS NULL/);
    assert.match(source,/excluded\.opponent_score IS NULL/);
  }
  assert.match(statewide,/excluded\.home_score IS NULL/);
  assert.match(statewide,/excluded\.away_score IS NULL/);
});

test("DragonFly refresh collapses safe logical aliases but refuses contradictory scored finals",()=>{
  assert.match(statewide,/completeRows\.map\(signature\)/);
  assert.match(statewide,/size>1/);
  assert.match(statewide,/julianday\(ce\.scheduled_at\)/);
  assert.match(statewide,/UPDATE games SET canonical_event_id=/);
});
