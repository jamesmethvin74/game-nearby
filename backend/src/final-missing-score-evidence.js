const IDS = Object.freeze([
  "ce:volleyball:girls:2026:df-7kza8c:df-cqpax3:20260825:df-695fcf130e0845562900001c",
  "ce:volleyball:girls:2026:df-8pkud7:df-qgka87:20260825:df-69babe474fd8441434000004"
]);
const MAX_READS = 200;

function rr(result){ return Number(result?.meta?.rows_read || 0); }
function rw(result){ return Number(result?.meta?.rows_written || 0); }

export async function readFinalMissingScoreEvidence(env){
  const [members, conflicts] = await env.DB.batch([
    env.DB.prepare(`
      SELECT ce.id AS canonical_id,ce.status AS canonical_status,ce.scheduled_at,
        ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score,
        ce.selected_source_id,ce.trust_state,ce.conflict_count,ce.resolution_json,
        cem.game_id,cem.source_id,cem.reporting_team_id,
        g.opponent,g.opponent_school_id,g.home_away,g.status AS game_status,
        g.team_score,g.opponent_score,g.result AS game_result,
        src.source_type,src.parser_type,src.authority_rank,src.collection_mode,src.enabled
      FROM canonical_events ce
      JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      JOIN games g ON g.id=cem.game_id
      JOIN sources src ON src.id=cem.source_id
      WHERE ce.id IN (?,?)
      ORDER BY ce.id,cem.reporting_team_id,src.authority_rank,src.id,cem.game_id
    `).bind(...IDS),
    env.DB.prepare(`
      SELECT id,canonical_event_id,conflict_type,values_json,evidence_json,detected_at,resolved_at
      FROM event_conflicts
      WHERE canonical_event_id IN (?,?)
      ORDER BY canonical_event_id,resolved_at,id
    `).bind(...IDS)
  ]);
  const d1={
    statements:2,
    rows_read:rr(members)+rr(conflicts),
    rows_written:rw(members)+rw(conflicts),
    per_statement:[
      {rows_read:rr(members),rows_written:rw(members)},
      {rows_read:rr(conflicts),rows_written:rw(conflicts)}
    ]
  };
  if(d1.rows_written!==0) throw new Error(`evidence read wrote ${d1.rows_written}`);
  if(d1.rows_read>MAX_READS) throw new Error(`evidence read fuse exceeded ${d1.rows_read}`);
  return {canonical_ids:IDS,members:members.results||[],conflicts:conflicts.results||[],d1};
}

export { MAX_READS as FINAL_MISSING_SCORE_EVIDENCE_MAX_READS };
