const TARGET_SCHOOLS=["df-3apqkq","df-bnytwl","df-g58a54","df-yghy8r"];
function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

export async function loadM7DuplicateSchoolProof(env){
  const targets=JSON.stringify(TARGET_SCHOOLS);
  const overview=await env.DB.prepare(`
    WITH target AS (SELECT value AS school_id FROM json_each(?)),
    game_stats AS (
      SELECT t.school_id,t.id AS team_id,COUNT(g.id) AS games,
        SUM(CASE WHEN g.status='FINAL' THEN 1 ELSE 0 END) AS finals,
        MIN(g.scheduled_at) AS first_game,MAX(g.scheduled_at) AS last_game,
        COUNT(DISTINCT g.canonical_event_id) AS attached_canonicals
      FROM teams t LEFT JOIN games g ON g.team_id=t.id
      WHERE t.school_id IN (SELECT school_id FROM target)
        AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      GROUP BY t.school_id,t.id
    ),
    canonical_stats AS (
      SELECT school_id,COUNT(*) AS canonical_events,
        SUM(CASE WHEN status='FINAL' THEN 1 ELSE 0 END) AS canonical_finals
      FROM (
        SELECT participant_a_school_id AS school_id,status FROM canonical_events
        WHERE participant_a_school_id IN (SELECT school_id FROM target) AND sport='volleyball' AND gender='girls' AND season='2026'
        UNION ALL
        SELECT participant_b_school_id AS school_id,status FROM canonical_events
        WHERE participant_b_school_id IN (SELECT school_id FROM target) AND sport='volleyball' AND gender='girls' AND season='2026'
      ) x GROUP BY school_id
    )
    SELECT s.id AS school_id,s.name,s.catalog_scope,s.membership_source,s.city,s.state,
      gs.team_id,gs.games,gs.finals,gs.first_game,gs.last_game,gs.attached_canonicals,
      cs.canonical_events,cs.canonical_finals
    FROM schools s
    LEFT JOIN game_stats gs ON gs.school_id=s.id
    LEFT JOIN canonical_stats cs ON cs.school_id=s.id
    WHERE s.id IN (SELECT school_id FROM target)
    ORDER BY s.id
  `).bind(targets).all();
  const identities=await env.DB.prepare(`
    SELECT 'school' AS kind,school_id,provider,external_school_id AS external_id,observed_name AS label,last_seen_at
    FROM school_external_identities
    WHERE school_id IN (SELECT value FROM json_each(?))
    UNION ALL
    SELECT 'team' AS kind,t.school_id,tei.provider,tei.external_team_id AS external_id,COALESCE(tei.external_code,'') AS label,tei.last_seen_at
    FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id
    WHERE t.school_id IN (SELECT value FROM json_each(?))
    ORDER BY school_id,kind,provider,external_id
  `).bind(targets,targets).all();
  const samples=await env.DB.prepare(`
    SELECT t.school_id,t.id AS team_id,g.id AS game_id,g.opponent,g.opponent_school_id,g.scheduled_at,g.status,
      g.team_score,g.opponent_score,g.canonical_event_id,src.parser_type,src.id AS source_id
    FROM teams t JOIN games g ON g.team_id=t.id JOIN sources src ON src.id=g.source_id
    WHERE t.school_id IN (SELECT value FROM json_each(?))
      AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
    ORDER BY t.school_id,g.scheduled_at,g.id
  `).bind(targets).all();
  const results=[overview,identities,samples];
  if(results.some(r=>rowsWritten(r)!==0))throw new Error("M7 duplicate-school proof wrote to D1");
  return {d1:{statements:3,rows_read:results.reduce((s,r)=>s+rowsRead(r),0),rows_written:0,per_statement:results.map((r,i)=>({statement:i+1,rows_read:rowsRead(r),rows_written:0}))},overview:overview.results||[],identities:identities.results||[],samples:samples.results||[]};
}

export { TARGET_SCHOOLS };
