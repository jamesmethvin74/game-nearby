import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchCollegeSourceMaterial,
  isCollegeRuntimeParser,
  parseCollegeSourceBody,
  sharedCollegeFetchKey
} from "../src/college-source-runtime.js";

test("M4 runtime recognizes only the M3 parser families missing from the deployed core", () => {
  assert.equal(isCollegeRuntimeParser("prestosports-rss"), true);
  assert.equal(isCollegeRuntimeParser("institutional-table"), true);
  assert.equal(isCollegeRuntimeParser("sidearm"), false);
  assert.equal(sharedCollegeFetchKey({parser_type:"prestosports-rss",source_url:"https://school.example/composite?print=rss"}), "prestosports-rss:https://school.example/composite?print=rss");
  assert.equal(sharedCollegeFetchKey({parser_type:"institutional-table",source_url:"https://school.example/schedule"}), null);
});

test("M4 shared Presto RSS fetch performs one provider request for sibling team rows", async () => {
  let calls = 0;
  const fetchFn = async (_url, options) => {
    calls += 1;
    assert.equal(options.headers["if-none-match"], undefined);
    return new Response("<rss></rss>", {status:200,headers:{"content-type":"application/rss+xml","etag":"abc"}});
  };
  const shared = new Map();
  const base = {
    parser_type:"prestosports-rss",
    source_url:"https://school.example/composite?print=rss",
    etag:"old-etag",
    last_modified:"yesterday"
  };
  const first = await fetchCollegeSourceMaterial({...base,team_id:"team-a"}, shared, {fetchFn,userAgent:"LocalBleachersAR/test"});
  const second = await fetchCollegeSourceMaterial({...base,team_id:"team-b",etag:"different-row-etag"}, shared, {fetchFn,userAgent:"LocalBleachersAR/test"});
  assert.equal(calls, 1);
  assert.equal(first.body, "<rss></rss>");
  assert.equal(second.body, first.body);
  assert.equal(first.etag, "abc");
});

test("M4 non-shared institutional fetch keeps conditional validators", async () => {
  const fetchFn = async (_url, options) => {
    assert.equal(options.headers["if-none-match"], "institution-etag");
    return new Response(null, {status:304});
  };
  const result = await fetchCollegeSourceMaterial({
    parser_type:"institutional-table",
    source_url:"https://school.example/schedule",
    etag:"institution-etag"
  }, new Map(), {fetchFn,userAgent:"LocalBleachersAR/test"});
  assert.equal(result.notModified, true);
  assert.equal(result.status, 304);
});

test("M4 Presto parser dispatch filters a school-wide feed to the exact target sport and season", async () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Men's Basketball</title><category>Men's Basketball</category><link>https://school.example/sports/mbkb/2026-27/schedule#game-1</link><dc:date>2026-11-01T01:00:00Z</dc:date><ps:opponent>at Example College</ps:opponent><ps:score></ps:score><description>Game on Nov 1, 2026: 8:00 PM</description></item>
    <item><title>Women's Volleyball</title><category>Women's Volleyball</category><link>https://school.example/sports/wvball/2026-27/schedule#game-2</link><dc:date>2026-09-10T00:00:00Z</dc:date><ps:opponent>Example U</ps:opponent><description>Game</description></item>
  </channel></rss>`;
  const events = await parseCollegeSourceBody(xml, {
    parser_type:"prestosports-rss",
    sport:"basketball",
    gender:"men",
    season:"2026",
    home_venue:"Reddin Fieldhouse",
    home_latitude:35.0,
    home_longitude:-92.0
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].opponent, "Example College");
  assert.equal(events[0].homeAway, "away");
});
