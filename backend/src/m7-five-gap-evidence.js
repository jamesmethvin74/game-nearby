const GAP_IDS=[
  "ce:volleyball:girls:2026:df-7x4sxh:df-ht8yyh:20260824:t1800",
  "ce:volleyball:girls:2026:df-dxgr8r:df-rpnt3m:20260903:t1830",
  "ce:volleyball:girls:2026:df-7x4sxh:df-ht8yyh:20260911:t1800",
  "ce:volleyball:girls:2026:df-7x4sxh:df-9mvcl7:20260919:t1630",
  "ce:volleyball:girls:2026:df-7x4sxh:df-wd92v5:20260923:t1500"
];
const MAX_ROWS_READ=10000;

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

export async function readM7FiveGapEvidence(env){
  const ids=JSON.stringify(GAP_IDS);
  const [evidence,conflicts]=await env.DB.batch([
    env.DB.prepare(`
      SELECT ce.id AS canonical_event_id,ce.scheduled_at AS canonical_scheduled_at,
        ce.status AS canonical_status,ce.home_school_id,ce.away_school_id,
        ce.home_score,ce.away_score,ce.selected_source_id,ce.trust_state,
        ce.conflict_count,ce.resolution_json,ce.last_reconciled_at,
        cem.reporting_team_id,cem.game_id,
        g.team_id AS game_team_id,g.source_id,g.source_event_key,g.opponent,
        g.opponent_school_id,g.scheduled_at AS game_scheduled_at,
        g.scheduled_time_known,g.status AS game_status,g.team_score,g.opponent_score,
        g.home_away,g.conference_game,g.counts_for_record,g.notes,
        g.source_updated_at,g.last_checked_at AS game_last_checked_at,g.updated_at AS game_updated_at,
        src.source_url,src.source_type,src.parser_type,src.parser_version,src.authority_rank,
        src.enabled AS source_enabled,src.last_successful_fetch_at,
        src.last_checked_at AS source_last_checked_at,src.updated_at AS source_updated_at_row
      FROM canonical_events ce
      LEFT JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      LEFT JOIN games g ON g.id=cem.game_id
      LEFT JOIN sources src ON src.id=g.source_id
      WHERE ce.id IN (SELECT value FROM json_each(?))
      ORDER BY ce.scheduled_at,ce.id,cem.reporting_team_id,cem.game_id
    `).bind(ids),
    env.DB.prepare(`
      SELECT canonical_event_id,conflict_type,values_json,evidence_json,detected_at,resolved_at
      FROM event_conflicts
      WHERE canonical_event_id IN (SELECT value FROM json_each(?))
      ORDER BY canonical_event_id,detected_at
    `).bind(ids)
  ]);

  const d1={
    statements:2,
    rows_read:rowsRead(evidence)+rowsRead(conflicts),
    rows_written:rowsWritten(evidence)+rowsWritten(conflicts),
    per_statement:[
      {rows_read:rowsRead(evidence),rows_written:rowsWritten(evidence)},
      {rows_read:rowsRead(conflicts),rows_written:rowsWritten(conflicts)}
    ]
  };
  if(d1.rows_written!==0) throw new Error(`five-gap evidence wrote ${d1.rows_written} rows`);
  if(d1.rows_read>MAX_ROWS_READ) throw new Error(`five-gap evidence exceeded read fuse: ${d1.rows_read}`);
  return {
    generated_at:new Date().toISOString(),
    expected_ids:GAP_IDS,
    evidence:evidence.results||[],
    conflicts:conflicts.results||[],
    d1
  };
}

export { GAP_IDS };
