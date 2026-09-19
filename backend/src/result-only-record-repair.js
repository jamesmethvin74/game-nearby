import { rebuildTeamRecords } from "./record-rebuild.js";

export const RESULT_ONLY_RECORD_REBUILD_MAX_TEAMS = 128;

export async function resultOnlyRecordRepairPlan(env) {
  const { results = [] } = await env.DB.prepare(`
    SELECT DISTINCT t.id AS team_id,t.school_id
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    JOIN sources src ON src.team_id=t.id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.level='high-school'
      AND LOWER(COALESCE(src.source_type,''))='official-school'
      AND LOWER(COALESCE(src.parser_type,'')) IN ('mascot-media','rankone-public')
    ORDER BY t.id
    LIMIT ?
  `).bind(RESULT_ONLY_RECORD_REBUILD_MAX_TEAMS + 1).all();

  return {
    too_large: results.length > RESULT_ONLY_RECORD_REBUILD_MAX_TEAMS,
    team_ids: results.map(row => String(row.team_id || "")).filter(Boolean),
    school_ids: [...new Set(results.map(row => String(row.school_id || "")).filter(Boolean))]
  };
}

export async function executeResultOnlyRecordRepair(env, now = new Date()) {
  const plan = await resultOnlyRecordRepairPlan(env);
  if (plan.too_large) throw new Error(`result-only record repair scope too large: ${plan.team_ids.length}/${RESULT_ONLY_RECORD_REBUILD_MAX_TEAMS}`);
  const checkedAt = now.toISOString();
  const rebuilt = plan.team_ids.length
    ? await rebuildTeamRecords(env, plan.team_ids, checkedAt)
    : { teams:0, scoredFinals:0, standings:{cohorts:0,standingsRows:0} };
  if (Number(rebuilt?.teams || 0) !== plan.team_ids.length) {
    throw new Error(`result-only record rebuild team count mismatch: ${rebuilt?.teams || 0}/${plan.team_ids.length}`);
  }
  return { status:"SUCCESS", checked_at:checkedAt, ...plan, rebuilt };
}
