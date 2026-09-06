import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { statewideDragonFlySignature } from "../src/dragonfly-statewide.js";
import { runVolleyballLiveResultProbe, volleyballResultSnapshotChanged } from "../src/volleyball-live-results.js";
import { buildVolleyballLiveCalculatedStandings } from "../src/volleyball-standings-overlay.js";

const fixture = fileURLToPath(new URL("./fixtures/dragonfly-greenbrier-vilonia-2026.json", import.meta.url));

function publishedVolleyball() {
  return {
    conference: { id:"5a-central", name:"5A Central", sport:"volleyball", standings_method:"published" },
    standings: [
      { rank:1, school_name:"Vilonia", conference_record:"2-0", overall_record:"4-1", method:"published" },
      { rank:2, school_name:"Greenbrier", conference_record:"1-1", overall_record:"3-2", method:"published" },
      { rank:3, school_name:"Maumelle", conference_record:"0-2", overall_record:"2-3", method:"published" }
    ]
  };
}

test("volleyball snapshot decision ignores identical semantic feed and detects score changes", () => {
  const payload = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const signature = statewideDragonFlySignature(payload);
  assert.deepEqual(
    volleyballResultSnapshotChanged(JSON.stringify({ signature }), payload),
    { changed:false, previousSignature:signature, signature }
  );

  const changed = structuredClone(payload);
  changed.schedule[0].participants[0].result.score = Number(changed.schedule[0].participants[0].result.score || 0) + 1;
  assert.equal(volleyballResultSnapshotChanged(JSON.stringify({ signature }), changed).changed, true);
});

test("unchanged live volleyball probe performs no D1 writes", async () => {
  const payload = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const signature = statewideDragonFlySignature(payload);
  let runs = 0;
  let reads = 0;
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /statewide_collection_state/);
        return {
          bind() { return this; },
          async first() { reads += 1; return { details_json:JSON.stringify({ signature }) }; },
          async run() { runs += 1; throw new Error("unchanged probe must not write D1"); }
        };
      }
    }
  };
  const fetchFn = async () => ({
    ok:true,
    status:200,
    async json() { return { ...payload, hasNextPage:false }; }
  });

  const result = await runVolleyballLiveResultProbe(env, {
    fetchFn,
    now:new Date("2026-09-02T23:00:00.000Z")
  });
  assert.equal(result.status, "NOT_MODIFIED");
  assert.equal(result.d1Writes, 0);
  assert.equal(reads, 1);
  assert.equal(runs, 0);
});

test("live volleyball records only advance published records and preserve the full roster", () => {
  const published = publishedVolleyball();
  const calculated = buildVolleyballLiveCalculatedStandings(published, [
    {
      normalized_alias:"greenbrier",
      team_id:"greenbrier-volleyball-2026",
      wins:4,losses:2,ties:0,
      conference_wins:2,conference_losses:1,conference_ties:0,
      calculated_at:"2026-09-02T23:00:00.000Z"
    },
    {
      normalized_alias:"vilonia",
      team_id:"vilonia-volleyball-2026",
      wins:3,losses:1,ties:0,
      conference_wins:1,conference_losses:0,conference_ties:0,
      calculated_at:"2026-09-02T23:00:00.000Z"
    }
  ]);

  assert.ok(calculated);
  const greenbrier = calculated.standings.find(row => row.school_name === "Greenbrier");
  assert.equal(greenbrier.overall_record, "4-2");
  assert.equal(greenbrier.conference_record, "2-1");
  assert.equal(
    calculated.standings.some(row => row.school_name === "Vilonia"),
    false,
    "a less-complete local record must not replace a more-complete published record"
  );
  assert.equal(published.standings.length, 3, "published roster is the conference membership authority");
});

test("standings GET path is read-only and uses the volleyball live overlay", async () => {
  const source = await readFile(new URL("../src/standings-worker.js", import.meta.url), "utf8");
  assert.match(source, /overlayVolleyballLiveRecords/);
  assert.doesNotMatch(source, /rebuildTeamRecords/);
  assert.doesNotMatch(source, /rebuildMissingCalculatedConference/);
});
