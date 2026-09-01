import test from "node:test";
import assert from "node:assert/strict";
import { parseConferenceLinks, parsePublishedStandings } from "../src/published-standings.js";

const conferenceDirectoryHtml = `
  <nav>
    <a href="/ar/volleyball/26-27/conference/6a-central/?leagueid=abc">6A Central</a>
    <a href="/ar/volleyball/26-27/conference/5a-central/?leagueid=def">5A Central</a>
    <a href="/ar/volleyball/26-27/conference/3a-3/?leagueid=ghi">3A 3</a>
  </nav>`;

const standingsHtml = `
  <table>
    <thead><tr><th>#</th><th>Team</th><th>W-L</th><th>PCT</th><th>SW</th><th>SL</th><th>W-L</th><th>PCT</th></tr></thead>
    <tbody>
      <tr><td>1</td><td><a href="/ar/conway/conway-wampus-cats/volleyball/">Conway</a></td><td>2-0</td><td>1.000</td><td>6</td><td>1</td><td>6-2</td><td>.750</td></tr>
      <tr><td>2</td><td>Cabot</td><td>1-1</td><td>.500</td><td>4</td><td>3</td><td>4-3</td><td>.571</td></tr>
    </tbody>
  </table>`;

test("discovers current conference links from the published sport page", () => {
  const rows = parseConferenceLinks(conferenceDirectoryHtml, { sport: "volleyball" });
  assert.deepEqual(rows.map(row => row.id), ["3a-3", "5a-central", "6a-central"]);
  assert.equal(rows.find(row => row.id === "6a-central").name, "6A Central");
});

test("parses conference and overall records from a published standings table", () => {
  const result = parsePublishedStandings(standingsHtml, {
    sport: "volleyball",
    conferenceId: "6a-central",
    conferenceName: "6A Central",
    sourceUrl: "https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/"
  });
  assert.equal(result.conference.name, "6A Central");
  assert.equal(result.standings.length, 2);
  assert.deepEqual(result.standings[0], {
    rank: 1,
    school_name: "Conway",
    conference_record: "2-0",
    overall_record: "6-2",
    conference_pct: "1.000",
    overall_pct: ".750",
    method: "published",
    source_url: "https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/"
  });
});
