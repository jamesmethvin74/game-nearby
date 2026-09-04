import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrestoSportsRss } from "../src/prestosports-rss.js";

const rss = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Central Baptist (AR), Arkansas-Pine Bluff, 1-5</title>
  <link>https://cbcmustangs.com/sports/wsoc/2026-27/schedule#h92y20vvzmgz0cwe</link>
  <description>Women's Soccer on Sep 1, 2026 at 1:00 PM: Central Baptist (AR), Arkansas-Pine Bluff, Final, 1-5</description>
  <category>Women's Soccer</category>
  <pubDate>Tue, 01 Sep 2026 18:00:00 GMT</pubDate>
  <guid>https://cbcmustangs.com/sports/wsoc/2026-27/schedule#h92y20vvzmgz0cwe</guid>
  <dc:date>2026-09-01T18:00:00Z</dc:date>
  <ps:score>L, 5-1</ps:score>
  <ps:opponent>at Arkansas-Pine Bluff</ps:opponent>
</item>
<item>
  <title>Old season row</title>
  <link>https://cbcmustangs.com/sports/wsoc/2025-26/schedule#old</link>
  <description>Women's Soccer on Mar 1, 2026 at 1:00 PM: Central Baptist (AR), Old Opponent, Final, 2-1</description>
  <category>Women's Soccer</category>
  <dc:date>2026-03-01T19:00:00Z</dc:date>
  <ps:score>W, 2-1</ps:score>
  <ps:opponent>Old Opponent</ps:opponent>
</item>
<item>
  <title>JV row</title>
  <link>https://cbcmustangs.com/sports/wsoc/2026-27jv/schedule#jv</link>
  <description>Women's Soccer JV on Sep 2, 2026 at 1:00 PM: Central Baptist (AR), JV Opponent</description>
  <category>Women's Soccer</category>
  <dc:date>2026-09-02T18:00:00Z</dc:date>
  <ps:opponent>JV Opponent</ps:opponent>
</item>
</channel></rss>`;

test("Presto RSS requires the exact target season and excludes JV", () => {
  const rows=normalizePrestoSportsRss(rss,{sport:"soccer",gender:"women",season:"2026",timezone:"America/Chicago"});
  assert.equal(rows.length,1);
  assert.equal(rows[0].opponent,"Arkansas-Pine Bluff");
  assert.equal(rows[0].homeAway,"away");
  assert.equal(rows[0].scheduledAt,"2026-09-01T18:00:00.000Z");
  assert.equal(rows[0].status,"FINAL");
  assert.equal(rows[0].result,"L");
  assert.equal(rows[0].teamScore,1);
  assert.equal(rows[0].opponentScore,5);
  assert.equal(rows[0].sourceEventKey,"native:h92y20vvzmgz0cwe");
});

test("Presto RSS filters a shared school-wide feed to the requested sport", () => {
  const mixed=`<rss><channel>
    <item><title>CRC MBB</title><link>https://www.crcpioneers.com/sports/mbkb/2026-27/schedule#mb1</link><description>Men's Basketball on Oct 30, 2026 at 6:00 PM: Fisk (TN), Crowley's Ridge</description><category>Men's Basketball</category><dc:date>2026-10-30T23:00:00Z</dc:date><ps:score/><ps:opponent>Fisk (TN)</ps:opponent></item>
    <item><title>CRC WVB</title><link>https://www.crcpioneers.com/sports/wvball/2026-27/schedule#vb1</link><description>Women's Volleyball on Aug 18, 2026 at 12:00 PM: Rust (MS), Crowley's Ridge, Final, 3-0</description><category>Women's Volleyball</category><dc:date>2026-08-18T17:00:00Z</dc:date><ps:score>W, 3-0</ps:score><ps:opponent>Rust (MS)</ps:opponent></item>
  </channel></rss>`;
  const mbb=normalizePrestoSportsRss(mixed,{sport:"basketball",gender:"men",season:"2026",home_venue:"Carter Activities Center"});
  assert.equal(mbb.length,1);
  assert.equal(mbb[0].opponent,"Fisk (TN)");
  assert.equal(mbb[0].homeAway,"home");
  assert.equal(mbb[0].venue,"Carter Activities Center");
  assert.equal(mbb[0].status,"SCHEDULED");
});

test("Presto RSS recognizes neutral-site games and record-exempt scrimmages", () => {
  const xml=`<rss><channel>
    <item><title>Neutral</title><link>https://wbueagles.com/sports/wvball/2026-27/schedule#n1</link><description>Women's Volleyball on Aug 20, 2026 at 4:00 PM: Williams Baptist (AR), Montana State-Northern (MT), Final, 0-3</description><category>Women's Volleyball</category><dc:date>2026-08-20T21:00:00Z</dc:date><ps:score>L, 3-0</ps:score><ps:opponent>vs. Montana State-Northern (MT) @ Butte, Mont. / Big Sky Challenge</ps:opponent></item>
    <item><title>Scrimmage</title><link>https://wbueagles.com/sports/wvball/2026-27/schedule#s1</link><description>Women's Volleyball on Aug 12, 2026 at 2:00 PM: Williams Baptist (AR), Test College, Scrimmage</description><category>Women's Volleyball</category><dc:date>2026-08-12T19:00:00Z</dc:date><ps:score/><ps:opponent>Test College</ps:opponent></item>
  </channel></rss>`;
  const rows=normalizePrestoSportsRss(xml,{sport:"volleyball",gender:"women",season:"2026"});
  assert.equal(rows.length,2);
  assert.equal(rows[0].homeAway,"neutral");
  assert.equal(rows[0].opponent,"Montana State-Northern (MT)");
  assert.equal(rows[0].venue,"Butte, Mont. / Big Sky Challenge");
  assert.equal(rows[0].teamScore,0);
  assert.equal(rows[0].opponentScore,3);
  assert.equal(rows[1].countsForRecord,0);
  assert.equal(rows[1].notes,"Scrimmage");
});
