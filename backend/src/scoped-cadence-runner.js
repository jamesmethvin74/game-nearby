const INTERNAL_REFRESH_TOKEN = "__localbleachers_scoped_cadence__";
const ORDINARY_MAX_SOURCES_PER_RUN = 4;
const COLLEGE_BOOTSTRAP_MAX_SOURCES_PER_RUN = 8;
const OFFICIAL_FINAL_RESULTS_MAX_SOURCES_PER_RUN = 256;

function safeSeason(value) {
  const season = String(value || "2026");
  if (!/^\d{4}$/.test(season)) throw new Error("Invalid college bootstrap season");
  return season;
}

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
  if (plan.scope === "high-school-final-results") {
    return {
      // Statewide final-only high-school sweep. It remains limited to official
      // school-operated result pages and to teams with games old enough to be
      // over but still represented locally as SCHEDULED. The 256-source ceiling
      // is large enough for a full Arkansas football slate while retaining a
      // hard production guardrail and the existing quota/server failure fuse.
      where: `sch.level='high-school'
        AND src.source_type='official-school'
        AND src.parser_type IN ('mascot-media','rankone-public')
        AND t.sport IN ('football','volleyball','basketball')`,
      activeMinutes: Number(plan.activeResultMinutes || 120),
      maxSources: OFFICIAL_FINAL_RESULTS_MAX_SOURCES_PER_RUN,
      gameWindow: `AND EXISTS (
        SELECT 1
        FROM games gx
        WHERE gx.team_id=t.id
          AND gx.status='SCHEDULED'
          AND gx.scheduled_time_known=1
          AND (
            (t.sport='football' AND datetime(gx.scheduled_at) BETWEEN datetime('now','-900 minutes') AND datetime('now','-150 minutes')) OR
            (t.sport='volleyball' AND datetime(gx.scheduled_at) BETWEEN datetime('now','-900 minutes') AND datetime('now','-90 minutes')) OR
            (t.sport='basketball' AND datetime(gx.scheduled_at) BETWEEN datetime('now','-900 minutes') AND datetime('now','-120 minutes'))
          )
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
  if (plan.scope === "college-bootstrap") {
    const season = safeSeason(plan.season);
    return {
      // Manual/approval-only M4 bootstrap scope. The ordinary scheduler never
      // emits this plan. Only enabled, active local college sources for the exact
      // target season are eligible, and any source that already owns a game row
      // is excluded from subsequent bootstrap batches.
      where: `sch.level='college' AND t.season='${season}'`,
      maxSources: COLLEGE_BOOTSTRAP_MAX_SOURCES_PER_RUN,
      gameWindow: `AND NOT EXISTS (
        SELECT 1
        FROM games gx
        WHERE gx.source_id=src.id
          AND gx.team_id=t.id
      )`,
      dueMode: "bootstrap"
    };
  }
  return null;
}

export function providerCollectionGroups(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const shared = row.parser_type === "prestosports-rss" && row.source_url;
    const key = shared ? `prestosports-rss:${row.source_url}` : `source:${row.id}`;
    if (!groups.has(key)) groups.set(key, { key, sourceIds: [] });
    groups.get(key).sourceIds.push(row.id);
  }
  return [...groups.values()];
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

  // Every core path is bounded. Event-day scopes use their short result polling
  // interval. Ordinary 6 AM / 3 PM / 11 PM passes use each source's own
  // refresh_minutes. The explicit M4 bootstrap ignores cadence age but only for
  // enabled college sources with zero game rows, capped at eight per invocation.
  const dueClause = policy.dueMode === "bootstrap"
    ? ""
    : policy.dueMode === "source-refresh"
      ? `AND (
          src.last_checked_at IS NULL OR
          datetime(src.last_checked_at, '+' || COALESCE(src.refresh_minutes,360) || ' minutes') <= datetime('now')
        )`
      : `AND (
          src.last_checked_at IS NULL OR
          datetime(src.last_checked_at, '+' || ? || ' minutes') <= datetime('now')
        )`;

  let query = env.DB.prepare(`
    SELECT src.id, src.team_id, src.last_checked_at, src.source_url, src.parser_type
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
  query = policy.dueMode === "bootstrap" || policy.dueMode === "source-refresh"
    ? query.bind(policy.maxSources)
    : query.bind(policy.activeMinutes, policy.maxSources);
  const selection = await query.all();
  const results = selection.results || [];
  const groups = providerCollectionGroups(results);
  console.log("d1 cadence selector", {
    kind: plan.kind,
    scope: plan.scope,
    maxSources: policy.maxSources,
    selectedSources: results.length,
    providerGroups: groups.length,
    rowsRead: Number(selection.meta?.rows_read || 0),
    rowsWritten: Number(selection.meta?.rows_written || 0),
    durationMs: Number(selection.meta?.duration || 0) || null
  });

  if (!results.length) {
    console.log("scoped cadence has no due sources", { kind: plan.kind, scope: plan.scope });
    return { status:"SKIPPED", plan:plan.kind, scope:plan.scope, sources:0, selectorRowsRead:Number(selection.meta?.rows_read || 0), outcomes:[] };
  }

  const scopedEnv = internalEnv(env);
  const outcomes = [];
  let attemptedSources = 0;

  // Only identical school-wide Presto RSS rows are batched together. Everything
  // else remains one source per internal refresh call, preserving the existing
  // failure boundary while allowing one provider fetch to serve sibling teams.
  for (const group of groups) {
    const request = new Request("https://localbleachers.internal/api/v1/refresh", {
      method:"POST",
      headers:{
        "content-type":"application/json",
        "x-refresh-token":INTERNAL_REFRESH_TOKEN
      },
      body:JSON.stringify({ sourceIds:group.sourceIds })
    });

    try {
      const response = await core.fetch(request, scopedEnv, ctx);
      const payload = await response.json().catch(() => ({}));
      attemptedSources += group.sourceIds.length;
      outcomes.push({ sourceIds:group.sourceIds, status:response.status, payload });
      if (response.status === 429 || response.status >= 500 || quotaLikeFailure(payload)) {
        console.warn("scoped cadence stopped after resource/server failure", { sourceIds:group.sourceIds, status:response.status });
        break;
      }
    } catch (error) {
      attemptedSources += group.sourceIds.length;
      outcomes.push({ sourceIds:group.sourceIds, status:"ERROR", error:String(error?.message || error) });
      console.warn("scoped cadence source group failed", { sourceIds:group.sourceIds, error:String(error?.message || error) });
      if (/d1|quota|row read|row write/i.test(String(error?.message || error))) break;
    }
  }

  return {
    status:"SUCCESS",
    plan:plan.kind,
    scope:plan.scope,
    selectedSources:results.length,
    providerGroups:groups.length,
    attemptedSources,
    selectorRowsRead:Number(selection.meta?.rows_read || 0),
    outcomes
  };
}

export { COLLEGE_BOOTSTRAP_MAX_SOURCES_PER_RUN, OFFICIAL_FINAL_RESULTS_MAX_SOURCES_PER_RUN, INTERNAL_REFRESH_TOKEN, safeSeason };
