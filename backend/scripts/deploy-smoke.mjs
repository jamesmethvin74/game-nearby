import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
const token = randomBytes(32).toString("hex");
const expectedSources = [
  "uca-football-official",
  "uca-mens-soccer-official",
  "hendrix-football-official",
  "conway-football-official"
];
const expectedSchedules = [
  ["uca-football-2026", 8],
  ["uca-mens-soccer-2026", 8],
  ["hendrix-football-2026", 7],
  ["conway-football-2026", 8]
];

function run(command, args, input = undefined) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
}

async function fetchJson(path, options = {}, attempts = 10) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        ...options,
        headers: {
          accept: "application/json",
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      let body;
      try { body = text ? JSON.parse(text) : null; }
      catch { body = { raw: text }; }
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 1000)}`);
      return body;
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

console.log("[smoke] Installing temporary REFRESH_TOKEN secret...");
run("npx", ["wrangler", "secret", "put", "REFRESH_TOKEN"], `${token}\n`);

console.log("[smoke] Deploying Worker...");
run("npx", ["wrangler", "deploy"]);

console.log("[smoke] Checking Worker + D1 health...");
const health = await fetchJson("/api/v1/health");
if (health.ok !== true || Number(health.teams) !== 4) {
  throw new Error(`Health check failed: ${JSON.stringify(health)}`);
}
console.log(`[smoke] Health OK: teams=${health.teams}, games=${health.games}`);

console.log("[smoke] Refreshing all four pilot sources...");
const refresh = await fetchJson("/api/v1/refresh", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-refresh-token": token
  },
  body: JSON.stringify({})
}, 3);
if (refresh.ok !== true) {
  throw new Error(`Pilot refresh failed: ${JSON.stringify(refresh)}`);
}

for (const sourceId of expectedSources) {
  const outcome = refresh.outcomes?.find(item => item.sourceId === sourceId);
  if (!outcome || !["SUCCESS", "NOT_MODIFIED"].includes(outcome.status)) {
    throw new Error(`Collector ${sourceId} failed: ${JSON.stringify(refresh)}`);
  }
  console.log(`[smoke] ${sourceId}: ${outcome.status}${outcome.gamesSeen ? `, games=${outcome.gamesSeen}` : ""}`);
}

const schedules = {};
for (const [teamId, minimumGames] of expectedSchedules) {
  const payload = await fetchJson(`/api/v1/teams/${teamId}/schedule`);
  const count = Array.isArray(payload.games) ? payload.games.length : 0;
  if (count < minimumGames) {
    throw new Error(`${teamId} schedule has ${count} games; expected at least ${minimumGames}`);
  }
  schedules[teamId] = count;
}

console.log("[smoke] Verifying Drake 1-1 final and derived record...");
const soccerSchedule = await fetchJson("/api/v1/teams/uca-mens-soccer-2026/schedule");
const drake = soccerSchedule.games?.find(game => String(game.opponent || "").toLowerCase().includes("drake"));
if (!drake) throw new Error("Drake game not found in live UCA soccer schedule");
if (drake.status !== "FINAL" || drake.result !== "T" || Number(drake.team_score) !== 1 || Number(drake.opponent_score) !== 1) {
  throw new Error(`Drake result mismatch: ${JSON.stringify(drake)}`);
}

const recordPayload = await fetchJson("/api/v1/teams/uca-mens-soccer-2026/record");
const record = recordPayload.record || {};
if (Number(record.ties || 0) < 1) {
  throw new Error(`Derived record did not include Drake tie: ${JSON.stringify(record)}`);
}

const sources = await fetchJson("/api/v1/sources");
for (const sourceId of expectedSources) {
  const row = sources.sources?.find(source => source.id === sourceId);
  if (!row || !row.last_successful_fetch_at || row.last_failure_at) {
    throw new Error(`Source freshness check failed for ${sourceId}: ${JSON.stringify(row)}`);
  }
}

console.log("[smoke] PASS: all pilot collectors verified");
console.log(JSON.stringify({
  health,
  schedules,
  drake: {
    opponent: drake.opponent,
    status: drake.status,
    result: drake.result,
    team_score: drake.team_score,
    opponent_score: drake.opponent_score,
    scheduled_at: drake.scheduled_at
  },
  record
}, null, 2));
