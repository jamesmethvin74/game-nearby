const MAX_ROWS_READ=20000;
const TARGET_NAMES=["pea ridge","harrison","providence academy","valley springs","mountain home","batesville"];
const AUG_START="2026-08-24T00:00:00.000Z";
const AUG_END="2026-08-26T06:00:00.000Z";
const SEP_START="2026-09-03T00:00:00.000Z";
const SEP_END="2026-09-05T06:00:00.000Z";

function rr(x){return Number(x?.meta?.rows_read||0);}
function rw(x){return Number(x?.meta?.rows_written||0);}

export async function readM7HistoricalTwoEvidence(env){
  const names=JSON.stringify(TARGET_NAMES);
  const teams=await env.DB.prepare(`
    SELECT t.id AS team_id,t.school_id,t.conference_id,
      s.name AS school_name,s.location_matched_name,s.catalog_scope
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
      AND (
        lower(trim(s.name)) IN (SELECT value FROM json_each(?))
        OR lower(trim(COALESCE(s.location_matched_name,''))) IN (SELECT value FROM json_each(?))
      )
    ORDER BY s.name,t.id
  `).bind(names,names).all();
  if(rw(teams)!==0) throw new Error(`team lookup wrote ${rw(teams)} rows`);
  const teamRows=teams.results||[];
  const teamIds=JSON.stringify([...new Set(teamRows.map(r=>r.team_id))]);
  const schoolIds=JSON.stringify([...new Set(teamRows.map(r=>r.school_id))]);

  const [games,canonicals]=await env.DB.batch([
    env.DB.prepare(`
      SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.opponent,g.opponent_school_id,
        g.scheduled_at,g.scheduled_time_known,g.status,g.team_score,g.opponent_score,g.result,
        g.home_away,g.conference_game,g.counts_for_record,g.canonical_event_id,g.notes,
        src.source_url,src.source_type,src.parser_type,src.parser_version,src.authority_rank,
        src.enabled,src.last_successful_fetch_at
      FROM games g JOIN sources src ON src.id=g.source_id
      WHERE g.team_id IN (SELECT value FROM json_each(?))
        AND ((g.scheduled_at>=? AND g.scheduled_at<?) OR (g.scheduled_at>=? AND g.scheduled_at<?))
      ORDER BY g.scheduled_at,g.team_id,g.id
    `).bind(teamIds,AUG_START,AUG_END,SEP_START,SEP_END),
    env.DB.prepare(`
      SELECT ce.id,ce.scheduled_at,ce.status,ce.home_school_id,ce.away_school_id,
        ce.home_score,ce.away_score,ce.selected_source_id,ce.trust_state,ce.conflict_count,
        ce.resolution_json,ce.last_reconciled_at,
        GROUP_CONCAT(DISTINCT cem.reporting_team_id) AS reporting_team_ids,
        GROUP_CONCAT(DISTINCT cem.game_id) AS member_game_ids,
        COUNT(DISTINCT cem.game_id) AS member_count
      FROM canonical_events ce
      LEFT JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      WHERE ce.sport='volleyball' AND ce.gender='girls' AND ce.season='2026'
        AND ((ce.scheduled_at>=? AND ce.scheduled_at<?) OR (ce.scheduled_at>=? AND ce.scheduled_at<?))
        AND (ce.home_school_id IN (SELECT value FROM json_each(?)) OR ce.away_school_id IN (SELECT value FROM json_each(?)))
      GROUP BY ce.id
      ORDER BY ce.scheduled_at,ce.id
    `).bind(AUG_START,AUG_END,SEP_START,SEP_END,schoolIds,schoolIds)
  ]);
  const d1={
    statements:3,
    rows_read:rr(teams)+rr(games)+rr(canonicals),
    rows_written:rw(teams)+rw(games)+rw(canonicals),
    per_statement:[
      {rows_read:rr(teams),rows_written:rw(teams)},
      {rows_read:rr(games),rows_written:rw(games)},
      {rows_read:rr(canonicals),rows_written:rw(canonicals)}
    ]
  };
  if(d1.rows_written!==0) throw new Error(`historical evidence wrote ${d1.rows_written} rows`);
  if(d1.rows_read>MAX_ROWS_READ) throw new Error(`historical evidence exceeded read fuse: ${d1.rows_read}`);
  if(teamRows.length<6||teamRows.length>8) throw new Error(`unexpected target team count ${teamRows.length}`);
  return {
    generated_at:new Date().toISOString(),
    target_names:TARGET_NAMES,
    teams:teamRows,
    games:games.results||[],
    canonicals:canonicals.results||[],
    d1
  };
}
