const CF_API = "https://api.cloudflare.com/client/v4";
const GITHUB_API = "https://api.github.com";
const GITHUB_REPO = "jamesmethvin74/game-nearby";
const WATCHED_BRANCH = "feature/live-sports-pipeline-m1";

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

async function github(path) {
  const response = await fetch(GITHUB_API + path, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "localbleachersar-ops-bridge",
      "x-github-api-version": "2022-11-28"
    }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) {
    const message = payload?.message || `GitHub API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function cf(env, path) {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("ops_bridge_token_missing");
  const response = await fetch(CF_API + path, {
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      accept: "application/json"
    }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map(x => x?.message).filter(Boolean).join("; ")
      || `Cloudflare API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function flattenStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) flattenStrings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) flattenStrings(item, out);
  return out;
}

function sanitize(line) {
  return String(line)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|password|api[_-]?key)\s*[=:]\s*[^\s"'<>]+/gi, "$1=[REDACTED]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[REDACTED_LONG_VALUE]")
    .slice(0, 1200);
}

function errorSummary(payload) {
  const lines = flattenStrings(payload)
    .map(sanitize)
    .map(x => x.trim())
    .filter(Boolean);
  const relevant = lines.filter(x => /error|fail|fatal|npm err|wrangler|exception|denied|unauthor|invalid/i.test(x));
  return [...new Set((relevant.length ? relevant : lines).slice(-30))];
}

function versionIdFromSummary(summary) {
  const match = String(summary || "").match(/Version ID:\s*([0-9a-f-]+)/i);
  return match ? match[1] : null;
}

function selectWorkerCheck(payload, targetWorker) {
  const expected = `Workers Builds: ${targetWorker}`;
  return (payload?.check_runs || []).find(row =>
    row?.name === expected &&
    row?.app?.slug === "cloudflare-workers-and-pages"
  ) || null;
}

function checkSummary(row) {
  return {
    source: "github_cloudflare_check_run",
    build_uuid: row?.external_id || null,
    status: row?.status || null,
    outcome: row?.conclusion || null,
    commit_hash: row?.head_sha || null,
    branch: row?.pull_requests?.[0]?.head?.ref || null,
    version_id: versionIdFromSummary(row?.output?.summary),
    started_at: row?.started_at || null,
    completed_at: row?.completed_at || null,
    details_url: row?.details_url || null
  };
}

async function enrichFailureLogs(env, summary) {
  if (summary.outcome !== "failure" || !summary.build_uuid) return summary;

  if (!env.CLOUDFLARE_API_TOKEN) {
    summary.log_enrichment = {
      status: "skipped",
      reason: "cloudflare_api_token_not_required_for_build_status"
    };
    return summary;
  }

  try {
    const logs = await cf(
      env,
      `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/builds/builds/${encodeURIComponent(summary.build_uuid)}/logs`
    );
    summary.error_summary = errorSummary(logs);
    summary.log_enrichment = { status: "ok" };
  } catch (error) {
    summary.log_enrichment = {
      status: "unavailable",
      reason: sanitize(error?.message || error)
    };
  }
  return summary;
}


async function directBuildLog(env, buildUuid) {
  const payload = await cf(
    env,
    `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/builds/builds/${encodeURIComponent(buildUuid)}/logs`
  );
  const lines = flattenStrings(payload)
    .map(sanitize)
    .map(x => x.trim())
    .filter(Boolean);
  return {
    source: "cloudflare_build_logs_direct",
    build_uuid: buildUuid,
    error_summary: errorSummary(payload),
    log_tail: [...new Set(lines.slice(-120))]
  };
}

async function buildForSha(env, sha) {
  const payload = await github(
    `/repos/${GITHUB_REPO}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`
  );
  const row = selectWorkerCheck(payload, env.TARGET_WORKER_NAME);
  if (!row) return null;
  return enrichFailureLogs(env, checkSummary(row));
}

async function latestWatchedSha() {
  const payload = await github(
    `/repos/${GITHUB_REPO}/branches/${encodeURIComponent(WATCHED_BRANCH)}`
  );
  return payload?.commit?.sha || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          service: "localbleachersar-ops-bridge",
          target_worker: env.TARGET_WORKER_NAME,
          status_source: "github_cloudflare_check_run",
          cloudflare_api_role: "optional_failed-build_log_enrichment_only",
          purpose: "deterministic Cloudflare Workers build truth for automation"
        });
      }


      if (url.pathname === "/v1/build-log") {
        const buildUuid = (url.searchParams.get("build_id") || "").trim().toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(buildUuid)) {
          return json({ error: "build_id_query_required", example: "/v1/build-log?build_id=<cloudflare-build-uuid>" }, 400);
        }
        return json(await directBuildLog(env, buildUuid));
      }

      if (url.pathname === "/v1/latest") {
        const sha = await latestWatchedSha();
        if (!sha) return json({ error: "watched_branch_head_not_found" }, 502);
        const build = await buildForSha(env, sha);
        if (!build) {
          return json({
            error: "build_not_found",
            target_worker: env.TARGET_WORKER_NAME,
            sha
          }, 404);
        }
        return json({
          target_worker: env.TARGET_WORKER_NAME,
          requested_sha: sha,
          build
        });
      }

      if (url.pathname === "/v1/build") {
        const sha = (url.searchParams.get("sha") || "").trim().toLowerCase();
        if (!/^[0-9a-f]{7,40}$/.test(sha)) {
          return json({ error: "sha_query_required", example: "/v1/build?sha=<git-sha>" }, 400);
        }
        const build = await buildForSha(env, sha);
        if (!build) {
          return json({
            error: "build_not_found",
            target_worker: env.TARGET_WORKER_NAME,
            sha
          }, 404);
        }
        return json({
          target_worker: env.TARGET_WORKER_NAME,
          requested_sha: sha,
          build
        });
      }

      return json({
        error: "not_found",
        endpoints: ["/health", "/v1/latest", "/v1/build?sha=<git-sha>", "/v1/build-log?build_id=<cloudflare-build-uuid>"]
      }, 404);
    } catch (error) {
      return json({
        error: "ops_bridge_failure",
        message: sanitize(error?.message || error)
      }, 502);
    }
  }
};
