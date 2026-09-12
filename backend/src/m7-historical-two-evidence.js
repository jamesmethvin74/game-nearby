const MAX_ROWS_READ=20000;
const TARGET_NAMES=["pea ridge","harrison","providence academy","valley springs","mountain home","batesville"];
const TARGET_CANONICAL_IDS=[
  "ce:volleyball:girls:2026:df-7x4sxh:df-ht8yyh:20260824:t1800",
  "ce:volleyball:girls:2026:df-dxgr8r:df-rpnt3m:20260903:t1830"
];
const AUG_START="2026-08-24T05:00:00.000Z";
const AUG_END="2026-08-25T05:00:00.000Z";
const SEP_START="2026-09-03T05:00:00.000Z";
const SEP_END="2026-09-04T05:00:00.000Z";

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
  if(rr(teams)>5000) throw new Error(`team lookup exceeded fuse: ${rr(teams)}`);
  const teamRows=teams.results||[];
  if(teamRows.length<6||teamRows.length>8) throw new Error(`unexpected target team count ${teamRows.length}`);
  const teamIds=JSON.stringify([...new Set(teamRows.map(r=>r.team_id))]);

  const games=await env.DB.prepare(`
    SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.opponent,g.opponent_school_id,
      g.scheduled_at,g.scheduled_time_known,g.status,g.team_score,g.opponent_score,g.result,
      g.home_away,g.conference_game,g.counts_for_record,g.canonical_event_id,g.notes,
      src.source_url,src.source_type,src.parser_type,src.parser_version,src.authority_rank,
      src.enabled,src.last_successful_fetch_at
    FROM games g JOIN sources src ON src.id=g.source_id
    WHERE g.team_id IN (SELECT value FROM json_each(?))
      AND ((g.scheduled_at>=? AND g.scheduled_at<?) OR (g.scheduled_at>=? AND g.scheduled_at<?))
    ORDER BY g.scheduled_at,g.team_id,g.id
  `).bind(teamIds,AUG_START,AUG_END,SEP_START,SEP_END).all();
  if(rw(games)!==0) throw new Error(`game lookup wrote ${rw(games)} rows`);
  if(rr(teams)+rr(games)>15000) throw new Error(`team+game lookup exceeded fuse: ${rr(teams)+rr(games)}`);
  const gameRows=games.results||[];

  const canonicalIds=JSON.stringify([...new Set([
    ...TARGET_CANONICAL_IDS,
    ...gameRows.map(r=>r.canonical_event_id).filter(Boolean)
  ])]);
  const [canonicals,members]=await env.DB.batch([
    env.DB.prepare(`
      SELECT id,scheduled_at,status,home_school_id,away_school_id,home_score,away_score,
        selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at
      FROM canonical_events
      WHERE id IN (SELECT value FROM json_each(?))
      ORDER BY scheduled_at,id
    `).bind(canonicalIds),
    env.DB.prepare(`
      SELECT cem.canonical_event_id,cem.reporting_team_id,cem.game_id,cem.source_id,
        g.status AS game_status,g.team_score,g.opponent_score,g.opponent_school_id,
        g.scheduled_at,g.source_event_key
      FROM canonical_event_members cem
      JOIN games g ON g.id=cem.game_id
      WHERE cem.canonical_event_id IN (SELECT value FROM json_each(?))
      ORDER BY cem.canonical_event_id,cem.reporting_team_id,cem.game_id
    `).bind(canonicalIds)
  ]);

  const d1={
    statements:4,
    rows_read:rr(teams)+rr(games)+rr(canonicals)+rr(members),
    rows_written:rw(teams)+rw(games)+rw(canonicals)+rw(members),
    per_statement:[
      {rows_read:rr(teams),rows_written:rw(teams)},
      {rows_read:rr(games),rows_written:rw(games)},
      {rows_read:rr(canonicals),rows_written:rw(canonicals)},
      {rows_read:rr(members),rows_written:rw(members)}
    ]
  };
  if(d1.rows_written!==0) throw new Error(`historical evidence wrote ${d1.rows_written} rows`);
  if(d1.rows_read>MAX_ROWS_READ) throw new Error(`historical evidence exceeded read fuse: ${d1.rows_read}`);
  return {
    generated_at:new Date().toISOString(),
    target_names:TARGET_NAMES,
    target_canonical_ids:TARGET_CANONICAL_IDS,
    teams:teamRows,
    games:gameRows,
    canonicals:canonicals.results||[],
    members:members.results||[],
    d1
  };
}
