const INTERNAL_REFRESH_TOKEN = "__localbleachers_scoped_cadence__";

export function scopePolicy(plan = {}) {
  if (plan.scope === "football-game-day") {
    return {
      where: "t.sport='football'",
      requireGameWindow: true,
      activeMinutes: Number(plan.activeResultMinutes || 30),
      maxSources: 32
    };
  }
  if (plan.scope === "college-game-day") {
    return {
      where: "sch.level='college'",
      requireGameWindow: true,
      activeMinutes: Number(plan.activeResultMinutes || 30),
      maxSources: 48
    };
  }
  return null;
}

function internalEnv(env) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "REFRESH_TOKEN") return INTERNAL_REFRESH_TOKEN;
      return Reflect.get(target, property, receiver);
    }
  });
}

function quotaLikeFailure(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return text.includes("d1_error") || text.includes("row read limit") || text.includes("row write limit") || text.includes("exceeded d1");
}

export async function runScopedCadence({ core, env, ctx, controller, plan }) {
  const policy = scopePolicy(plan);
  if (!policy) return null;

  const gameWindow = policy.requireGameWindow
    ? `AND EXISTS (
        SELECT 1
        FROM games gx
        WHERE gx.team_id=t.id
          AND datetime(gx.scheduled_at) BETWEEN datetime('now','-8 hours') AND datetime('now','+12 hours')
      )`
    : "";

  // One bounded set-based read decides which sources are eligible. Ordering by
  // oldest check time prevents a busy Saturday from starving sources beyond the
  // per-tick ceiling.
  const { results = [] } = await env.DB.prepare(`
    SELECT src.id, src.team_id, src.last_checked_at
    FROM sources src
    JOIN teams t ON t.id=src.team_id AND t.active=1
    JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local'
    WHERE src.enabled=1
      AND ${policy.where}
      ${gameWindow}
      AND (
        src.last_checked_at IS NULL OR
        datetime(src.last_checked_at, '+' || ? || ' minutes') <= datetime('now')
      )
    ORDER BY src.last_checked_at IS NOT NULL, src.last_checked_at, src.authority_rank, src.source_priority, src.id
    LIMIT ?
  `).bind(policy.activeMinutes, policy.maxSources).all();

  if (!results.length) {
    console.log("scoped cadence has no due game-day sources", { kind: plan.kind, scope: plan.scope });
    return { status: "SKIPPED", plan: plan.kind, scope: plan.scope, sources: 0, outcomes: [] };
  }

  const scopedEnv = internalEnv(env);
  const outcomes = [];

  for (const source of results) {
    const request = new Request("https://localbleachers.internal/api/v1/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-refresh-token": INTERNAL_REFRESH_TOKEN
      },
      body: JSON.stringify({ sourceId: source.id })
    });

    try {
      const response = await core.fetch(request, scopedEnv, ctx);
      const payload = await response.json().catch(() => ({}));
      outcomes.push({ sourceId: source.id, status: response.status, payload });
      if (response.status === 429 || response.status >= 500 || quotaLikeFailure(payload)) {
        console.warn("scoped cadence stopped after resource/server failure", { sourceId: source.id, status: response.status });
        break;
      }
    } catch (error) {
      outcomes.push({ sourceId: source.id, status: "ERROR", error: String(error?.message || error) });
      console.warn("scoped cadence source failed", { sourceId: source.id, error: String(error?.message || error) });
      if (/d1|quota|row read|row write/i.test(String(error?.message || error))) break;
    }
  }

  return {
    status: "SUCCESS",
    plan: plan.kind,
    scope: plan.scope,
    selectedSources: results.length,
    attemptedSources: outcomes.length,
    outcomes
  };
}
