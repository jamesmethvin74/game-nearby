import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { providerCollectionGroups, scopePolicy } from "../src/scoped-cadence-runner.js";

test("M4 Saturday college cadence remains bounded to eight due source rows", () => {
  const policy = scopePolicy({scope:"college-game-day",activeResultMinutes:30});
  assert.equal(policy.maxSources,8);
  assert.equal(policy.activeMinutes,30);
  assert.match(policy.where,/college/);
  assert.match(policy.gameWindow,/status='SCHEDULED'/);
});

test("M4 cadence groups only identical school-wide Presto RSS provider requests", () => {
  const rows = [
    {id:"cbc-msoc",parser_type:"prestosports-rss",source_url:"https://cbc.example/composite?print=rss"},
    {id:"cbc-wsoc",parser_type:"prestosports-rss",source_url:"https://cbc.example/composite?print=rss"},
    {id:"cbc-wvb",parser_type:"prestosports-rss",source_url:"https://cbc.example/composite?print=rss"},
    {id:"sidearm-a",parser_type:"sidearm",source_url:"https://school.example/sports/a/schedule/2026"},
    {id:"sidearm-b",parser_type:"sidearm",source_url:"https://school.example/sports/a/schedule/2026"}
  ];
  const groups = providerCollectionGroups(rows);
  assert.equal(groups.length,3);
  assert.deepEqual(groups[0].sourceIds,["cbc-msoc","cbc-wsoc","cbc-wvb"]);
  assert.deepEqual(groups[1].sourceIds,["sidearm-a"]);
  assert.deepEqual(groups[2].sourceIds,["sidearm-b"]);
});

test("M4 internal refresh path is bounded and cannot silently turn an empty scope into refresh-all", () => {
  const core = fs.readFileSync(new URL("../src/index.js", import.meta.url),"utf8");
  const runner = fs.readFileSync(new URL("../src/scoped-cadence-runner.js", import.meta.url),"utf8");
  assert.match(core,/MAX_SCOPED_REFRESH_SOURCES=16/);
  assert.match(core,/invalid_source_scope/);
  assert.match(core,/src\.id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(runner,/body:JSON\.stringify\(\{ sourceIds:group\.sourceIds \}\)/);
  assert.doesNotMatch(runner,/body:JSON\.stringify\(\{ sourceId: source\.id \}\)/);
});
