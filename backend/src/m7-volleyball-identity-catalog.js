function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

export async function loadM7VolleyballIdentityCatalog(env){
  const result=await env.DB.prepare(`
    WITH duplicate_target(school_id) AS (
      VALUES ('df-3apqkq'),('df-bnytwl'),('df-g58a54'),('df-yghy8r')
    ),
    game_stats AS (
      SELECT t.school_id,COUNT(g.id) AS game_count,
        SUM(CASE WHEN g.status='FINAL' THEN 1 ELSE 0 END) AS final_count,
        COUNT(DISTINCT g.canonical_event_id) AS attached_canonical_count,
        MIN(g.scheduled_at) AS first_game,MAX(g.scheduled_at) AS last_game
      FROM teams t LEFT JOIN games g ON g.team_id=t.id
      WHERE t.school_id IN (SELECT school_id FROM duplicate_target)
        AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      GROUP BY t.school_id
    ),
    canonical_stats AS (
      SELECT school_id,COUNT(*) AS canonical_count,
        SUM(CASE WHEN status='FINAL' THEN 1 ELSE 0 END) AS canonical_final_count
      FROM (
        SELECT participant_a_school_id AS school_id,status FROM canonical_events
        WHERE participant_a_school_id IN (SELECT school_id FROM duplicate_target)
          AND sport='volleyball' AND gender='girls' AND season='2026'
        UNION ALL
        SELECT participant_b_school_id AS school_id,status FROM canonical_events
        WHERE participant_b_school_id IN (SELECT school_id FROM duplicate_target)
          AND sport='volleyball' AND gender='girls' AND season='2026'
      ) x GROUP BY school_id
    )
    SELECT
      s.id AS school_id,s.name AS raw_school_name,s.location_matched_name,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
      s.city,s.state,s.address,s.postal_code,s.catalog_scope,s.membership_source,
      t.id AS team_id,t.active AS team_active,t.conference_id,
      gs.game_count,gs.final_count,gs.attached_canonical_count,gs.first_game,gs.last_game,
      cs.canonical_count,cs.canonical_final_count
    FROM schools s
    LEFT JOIN teams t
      ON t.school_id=s.id
      AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
    LEFT JOIN game_stats gs ON gs.school_id=s.id
    LEFT JOIN canonical_stats cs ON cs.school_id=s.id
    WHERE s.level='high-school'
    ORDER BY s.catalog_scope,s.state,s.city,school_name,COALESCE(t.id,'')
  `).all();
  if(rowsWritten(result)!==0) throw new Error("M7 identity catalog wrote to D1");
  return {d1:{statements:1,rows_read:rowsRead(result),rows_written:0},teams:result.results||[]};
}
