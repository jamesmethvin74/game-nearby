const MAX_ROWS_READ=20000;
const KNOWN_TEAM_IDS=[
  "df-7x4sxh-volleyball-2026",
  "df-ht8yyh-volleyball-2026",
  "df-dxgr8r-volleyball-2026",
  "df-rpnt3m-volleyball-2026"
];
const TARGET_ALIAS_KEYS=["providence academy","valley springs"];
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
  const aliases=await env.DB.prepare(`
    SELECT normalized_alias,school_id,alias_text
    FROM school_aliases
    WHERE normalized_alias IN (SELECT value FROM json_each(?))
    ORDER BY normalized_alias
  `).bind(JSON.stringify(TARGET_ALIAS_KEYS)).all();
  if(rw(aliases)!==0) throw new Error(`alias lookup wrote ${rw(aliases)} rows`);
  if(rr(aliases)>100) throw new Error(`alias lookup exceeded fuse: ${rr(aliases)}`);
  const aliasRows=aliases.results||[];
  const aliasSchoolIds=[...new Set(aliasRows.map(r=>r.school_id).filter(Boolean))];

  let extraTeams={results:[],meta:{rows_read:0,rows_written:0}};
  if(aliasSchoolIds.length){
    extraTeams=await env.DB.prepare(`
      SELECT t.id AS team_id,t.school_id,t.conference_id,
        s.name AS school_name,s.location_matched_name,s.catalog_scope
      FROM teams t JOIN schools s ON s.id=t.school_id
      WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
        AND t.school_id IN (SELECT value FROM json_each(?))
      ORDER BY t.id
    `).bind(JSON.stringify(aliasSchoolIds)).all();
  }
  if(rw(extraTeams)!==0) throw new Error(`alias team lookup wrote ${rw(extraTeams)} rows`);

  const allTeamIds=[...new Set([
    ...KNOWN_TEAM_IDS,
    ...(extraTeams.results||[]).map(r=>r.team_id).filter(Boolean)
  ])];
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
  `).bind(JSON.stringify(allTeamIds),AUG_START,AUG_END,SEP_START,SEP_END).all();
  if(rw(games)!==0) throw new Error(`game lookup wrote ${rw(games)} rows`);
  const preReads=rr(aliases)+rr(extraTeams)+rr(games);
  if(preReads>15000) throw new Error(`alias/team/game lookup exceeded fuse: ${preReads}`);
  const gameRows=games.results||[];

  const canonicalIds=[...new Set([
    ...TARGET_CANONICAL_IDS,
    ...gameRows.map(r=>r.canonical_event_id).filter(Boolean)
  ])];
  const [canonicals,members]=await env.DB.batch([
    env.DB.prepare(`
      SELECT id,scheduled_at,status,home_school_id,away_school_id,home_score,away_score,
        selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at
      FROM canonical_events
      WHERE id IN (SELECT value FROM json_each(?))
      ORDER BY scheduled_at,id
    `).bind(JSON.stringify(canonicalIds)),
    env.DB.prepare(`
      SELECT cem.canonical_event_id,cem.reporting_team_id,cem.game_id,cem.source_id,
        g.status AS game_status,g.team_score,g.opponent_score,g.opponent_school_id,
        g.scheduled_at,g.source_event_key
      FROM canonical_event_members cem
      JOIN games g ON g.id=cem.game_id
      WHERE cem.canonical_event_id IN (SELECT value FROM json_each(?))
      ORDER BY cem.canonical_event_id,cem.reporting_team_id,cem.game_id
    `).bind(JSON.stringify(canonicalIds))
  ]);

  const d1={
    statements:5,
    rows_read:rr(aliases)+rr(extraTeams)+rr(games)+rr(canonicals)+rr(members),
    rows_written:rw(aliases)+rw(extraTeams)+rw(games)+rw(canonicals)+rw(members),
    per_statement:[
      {rows_read:rr(aliases),rows_written:rw(aliases)},
      {rows_read:rr(extraTeams),rows_written:rw(extraTeams)},
      {rows_read:rr(games),rows_written:rw(games)},
      {rows_read:rr(canonicals),rows_written:rw(canonicals)},
      {rows_read:rr(members),rows_written:rw(members)}
    ]
  };
  if(d1.rows_written!==0) throw new Error(`historical evidence wrote ${d1.rows_written} rows`);
  if(d1.rows_read>MAX_ROWS_READ) throw new Error(`historical evidence exceeded read fuse: ${d1.rows_read}`);
  return {
    generated_at:new Date().toISOString(),
    known_team_ids:KNOWN_TEAM_IDS,
    aliases:aliasRows,
    extra_teams:extraTeams.results||[],
    queried_team_ids:allTeamIds,
    target_canonical_ids:TARGET_CANONICAL_IDS,
    games:gameRows,
    canonicals:canonicals.results||[],
    members:members.results||[],
    d1
  };
}
