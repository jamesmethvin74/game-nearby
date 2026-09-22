const API = "https://api.cloudflare.com/client/v4";

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

async function cf(env, path) {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("ops_bridge_token_missing");
  const response = await fetch(API + path, {
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

async function workerTag(env) {
  const payload = await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`);
  const row = (payload.result || []).find(x => x?.id === env.TARGET_WORKER_NAME);
  if (!row?.tag) throw new Error("target_worker_tag_not_found");
  return row.tag;
}

function buildSummary(row) {
  const meta = row?.build_trigger_metadata || {};
  return {
    build_uuid: row?.build_uuid || null,
    status: row?.status || null,
    outcome: row?.build_outcome || null,
    commit_hash: meta?.commit_hash || null,
    commit_message: meta?.commit_message || null,
    branch: meta?.branch || null,
    trigger_source: meta?.build_trigger_source || null,
    created_on: row?.created_on || null,
    initializing_on: row?.initializing_on || null,
    running_on: row?.running_on || null,
    modified_on: row?.modified_on || null
  };
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

async function builds(env) {
  const tag = await workerTag(env);
  const payload = await cf(
    env,
    `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/builds/workers/${encodeURIComponent(tag)}/builds?per_page=100&page=1`
  );
  return Array.isArray(payload.result) ? payload.result : [];
}

async function buildWithOptionalError(env, row) {
  const summary = buildSummary(row);
  if (summary.outcome === "fail" && summary.build_uuid) {
    try {
      const logs = await cf(
        env,
        `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/builds/builds/${encodeURIComponent(summary.build_uuid)}/logs`
      );
      summary.error_summary = errorSummary(logs);
    } catch (error) {
      summary.error_summary = [`log_lookup_failed: ${error.message}`];
    }
  }
  return summary;
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
          purpose: "sanitized Cloudflare Workers build truth for automation"
        });
      }

      if (url.pathname === "/v1/latest") {
        const rows = await builds(env);
        if (!rows.length) return json({ error: "no_builds_found" }, 404);
        return json({
          target_worker: env.TARGET_WORKER_NAME,
          build: await buildWithOptionalError(env, rows[0])
        });
      }

      if (url.pathname === "/v1/build") {
        const sha = (url.searchParams.get("sha") || "").trim().toLowerCase();
        if (!/^[0-9a-f]{7,40}$/.test(sha)) {
          return json({ error: "sha_query_required", example: "/v1/build?sha=<git-sha>" }, 400);
        }
        const rows = await builds(env);
        const row = rows.find(x => {
          const commit = String(x?.build_trigger_metadata?.commit_hash || "").toLowerCase();
          return commit === sha || commit.startsWith(sha) || sha.startsWith(commit);
        });
        if (!row) {
          return json({
            error: "build_not_found",
            target_worker: env.TARGET_WORKER_NAME,
            sha,
            builds_examined: rows.length
          }, 404);
        }
        return json({
          target_worker: env.TARGET_WORKER_NAME,
          requested_sha: sha,
          build: await buildWithOptionalError(env, row)
        });
      }

      return json({
        error: "not_found",
        endpoints: ["/health", "/v1/latest", "/v1/build?sha=<git-sha>"]
      }, 404);
    } catch (error) {
      return json({
        error: "ops_bridge_failure",
        message: String(error?.message || error)
      }, 502);
    }
  }
};
