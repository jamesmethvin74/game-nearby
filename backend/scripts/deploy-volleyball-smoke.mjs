import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
const token = randomBytes(32).toString("hex");
const targets = [
  { sourceId:"uca-volleyball-official", teamId:"uca-volleyball-2026", minimumGames:20, mustInclude:"Denver" },
  { sourceId:"conway-volleyball-official", teamId:"conway-volleyball-2026", minimumGames:8, mustInclude:"Benton" }
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
        headers: { accept:"application/json", ...(options.headers || {}) }
      });
      const text = await response.text();
      let body;
      try { body = text ? JSON.parse(text) : null; }
      catch { body = { raw:text }; }
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0,1000)}`);
      return body;
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

console.log("[volleyball-smoke] Running local checks...");
run("npm", ["run", "check"]);

console.log("[volleyball-smoke] Installing temporary REFRESH_TOKEN secret...");
run("npx", ["wrangler", "secret", "put", "REFRESH_TOKEN"], `${token}\n`);

console.log("[volleyball-smoke] Deploying Worker...");
run("npx", ["wrangler", "deploy"]);

console.log("[volleyball-smoke] Checking Worker and auto-seeded D1 config...");
const health = await fetchJson("/api/v1/health");
if (health.ok !== true || Number(health.teams) < 6) {
  throw new Error(`Expected at least 6 configured teams after volleyball seed: ${JSON.stringify(health)}`);
}

const verified = {};
for (const target of targets) {
  console.log(`[volleyball-smoke] Refreshing ${target.sourceId}...`);
  const refresh = await fetchJson("/api/v1/refresh", {
    method:"POST",
    headers:{ "content-type":"application/json", "x-refresh-token":token },
    body:JSON.stringify({ sourceId:target.sourceId })
  }, 3);
  const outcome = refresh.outcomes?.find(item => item.sourceId === target.sourceId);
  if (!refresh.ok || !outcome || !["SUCCESS","NOT_MODIFIED"].includes(outcome.status)) {
    throw new Error(`${target.sourceId} refresh failed: ${JSON.stringify(refresh)}`);
  }

  const schedule = await fetchJson(`/api/v1/teams/${target.teamId}/schedule`);
  const games = Array.isArray(schedule.games) ? schedule.games : [];
  if (games.length < target.minimumGames) {
    throw new Error(`${target.teamId} returned ${games.length} games; expected at least ${target.minimumGames}`);
  }
  const expectedGame = games.find(game => String(game.opponent || "").toLowerCase().includes(target.mustInclude.toLowerCase()));
  if (!expectedGame || !String(expectedGame.scheduled_at || "").startsWith("2026-")) {
    throw new Error(`${target.teamId} did not contain expected 2026 opponent ${target.mustInclude}`);
  }
  verified[target.teamId] = { games:games.length, expectedOpponent:expectedGame.opponent, scheduledAt:expectedGame.scheduled_at };
}

const uca = await fetchJson("/api/v1/teams/uca-volleyball-2026");
if (uca.team?.conference_name !== "United Athletic Conference") {
  throw new Error(`UCA volleyball conference mismatch: ${JSON.stringify(uca.team)}`);
}

const sources = await fetchJson("/api/v1/sources");
for (const target of targets) {
  const source = sources.sources?.find(row => row.id === target.sourceId);
  if (!source?.last_successful_fetch_at || source.last_failure_at || source.last_error) {
    throw new Error(`Source freshness failed for ${target.sourceId}: ${JSON.stringify(source)}`);
  }
}

console.log("[volleyball-smoke] PASS");
console.log(JSON.stringify({ health, verified }, null, 2));
