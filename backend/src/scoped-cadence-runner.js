const INTERNAL_REFRESH_TOKEN = "__localbleachers_scoped_cadence__";
const ORDINARY_MAX_SOURCES_PER_RUN = 4;

export function scopePolicy(plan = {}) {
  if (plan.scope === "all") {
    return {
      where: "1=1",
      maxSources: ORDINARY_MAX_SOURCES_PER_RUN,
      gameWindow: "",
      dueMode: "source-refresh"
    };
  }
  if (plan.scope === "football-game-day") {
    return {
      where: "t.sport='football'",
      activeMinutes: Number(plan.activeResultMinutes || 30),
      maxSources: 16,
      gameWindow: `AND EXISTS (
        SELECT 1
        FROM games gx
        WHERE gx.team_id=t.id
          AND gx.status='SCHEDULED'
          AND gx.scheduled_time_known=1
          AND datetime(gx.scheduled_at) BETWEEN datetime('now','-330 minutes') AND datetime('now','-120 minutes')
      )`,
      dueMode: "active-result"
    };
  }
  if (plan.scope === "college-game-day") {
    return {
      where: "sch.level='college'",
      activeMinutes: Number(plan.activeResultMinutes || 30),
      maxSources: 8,
      gameWindow: `AND EXISTS (
        SELECT 1
        FROM games gx
        WHERE gx.team_id=t.id
          AND gx.status='SCHEDULED'
          AND gx.scheduled_time_known=1
          AND (
            (t.sport='football' AND datetime(gx.scheduled_at) BETWEEN datetime('now','-360 minutes') AND datetime('now','-120 minutes')) OR
            (t.sport='basketball' AND datetime(gx.scheduled_at) BETWEEN datetime('now','-210 minutes') AND datetime('now','-75 minutes')) OR
            (t.sport='soccer' AND datetime(gx.scheduled_at) BETWEEN datetime('now','-240 minutes') AND datetime('now','-90 minutes')) OR
            (t.sport='volleyball' AND datetime(gx.scheduled_at) BETWEEN datetime('now','-270 minutes') AND datetime('now','-75 minutes')) OR
            (t.sport NOT IN ('football','basketball','soccer','volleyball') AND datetime(gx.scheduled_at) BETWEEN datetime('now','-300 minutes') AND datetime('now','-90 minutes'))
          )
      )`,
      dueMode: "active-result"
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

  // Every scheduled core path is now bounded. Event-day scopes use their short
  // result polling interval. Ordinary 6 AM / 3 PM / 11 PM passes use each
  // source's own refresh_minutes and rotate oldest-checked sources first rather
  // than enumerating every enabled source in one Worker invocation.
  const dueClause = policy.dueMode === "source-refresh"
    ? `AND (
        src.last_checked_at IS NULL OR
        datetime(src.last_checked_at, '+' || COALESCE(src.refresh_minutes,360) || ' minutes') <= datetime('now')
      )`
    : `AND (
        src.last_checked_at IS NULL OR
        datetime(src.last_checked_at, '+' || ? || ' minutes') <= datetime('now')
      )`;

  let query = env.DB.prepare(`
    SELECT src.id, src.team_id, src.last_checked_at
    FROM sources src
    JOIN teams t ON t.id=src.team_id AND t.active=1
    JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local'
    WHERE src.enabled=1
      AND ${policy.where}
      ${policy.gameWindow}
      ${dueClause}
    ORDER BY src.last_checked_at IS NOT NULL, src.last_checked_at, src.authority_rank, src.source_priority, src.id
    LIMIT ?
  `);
  query = policy.dueMode === "source-refresh"
    ? query.bind(policy.maxSources)
    : query.bind(policy.activeMinutes, policy.maxSources);
  const selection = await query.all();
  const results = selection.results || [];
  console.log("d1 cadence selector", {
    kind: plan.kind,
    scope: plan.scope,
    maxSources: policy.maxSources,
    selectedSources: results.length,
    rowsRead: Number(selection.meta?.rows_read || 0),
    rowsWritten: Number(selection.meta?.rows_written || 0),
    durationMs: Number(selection.meta?.duration || 0) || null
  });

  if (!results.length) {
    console.log("scoped cadence has no due sources", { kind: plan.kind, scope: plan.scope });
    return { status: "SKIPPED", plan: plan.kind, scope: plan.scope, sources: 0, selectorRowsRead: Number(selection.meta?.rows_read || 0), outcomes: [] };
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
    selectorRowsRead: Number(selection.meta?.rows_read || 0),
    outcomes
  };
}
