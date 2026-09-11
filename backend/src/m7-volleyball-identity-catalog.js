function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

export async function loadM7VolleyballIdentityCatalog(env){
  const result=await env.DB.prepare(`
    SELECT
      s.id AS school_id,s.name AS raw_school_name,s.location_matched_name,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
      s.city,s.state,s.address,s.postal_code,s.catalog_scope,
      t.id AS team_id,t.active AS team_active,t.conference_id
    FROM schools s
    LEFT JOIN teams t
      ON t.school_id=s.id
      AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
    WHERE s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    ORDER BY s.city,school_name,COALESCE(t.id,'')
  `).all();
  if(rowsWritten(result)!==0) throw new Error("M7 identity catalog wrote to D1");
  return {d1:{statements:1,rows_read:rowsRead(result),rows_written:0},teams:result.results||[]};
}
