import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), "utf8");

test("client release presents one factual display contract on all three surfaces", () => {
  const runtime = read("runtime-build.js");
  const presentation = read("presentation-status.js");
  const polish = read("polish.js");
  const detail = read("team-detail.js");
  const standings = read("standings.js");
  const schedule = read("school-schedule.js");
  const index = read("index.html");
  const standingsHtml = read("standings.html");
  const teamsHtml = read("teams.html");
  const sw = read("service-worker.js");

  assert.match(runtime, /m15-presentation-v72/);
  assert.match(runtime, /clientGeneration:\s*72/);
  assert.match(runtime, /shellGeneration:\s*72/);
  assert.match(runtime, /scheduleCacheSchema:\s*5/);

  for (const field of ["display_overall_record", "display_conference_record", "display_rank"]) {
    assert.match(presentation, new RegExp(field));
  }

  assert.match(polish, /LocalBleachersPresentation\?\.teamStatus/);
  assert.match(detail, /LocalBleachersPresentation\?\.teamStatus/);
  assert.match(standings, /LocalBleachersPresentation\?\.standingRow/);
  assert.doesNotMatch(standings, /Published standings are available only as evidence/);

  assert.match(schedule, /localBleachersAR:teamSchedule:v5:/);
  assert.match(schedule, /schemaVersion:\s*5/);
  assert.match(schedule, /primeVisibleTeamStatuses/);

  for (const html of [index, standingsHtml, teamsHtml]) {
    assert.match(html, /runtime-build\.js\?v=72/);
    assert.match(html, /service-worker\.js\?v=72/);
    assert.match(html, /updateViaCache:"none"/);
  }

  assert.match(sw, /localbleachersar-shell-v72/);
});

test("zero-game conference records cannot fabricate a number-one standing", () => {
  assert.match(read("presentation-status.js"), /gamesInRecord\(conference\) > 0/);
});
