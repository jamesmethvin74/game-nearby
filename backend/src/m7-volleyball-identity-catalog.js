function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

export async function loadM7VolleyballIdentityCatalog(env){
  const result=await env.DB.prepare(`
    SELECT t.id AS team_id,t.school_id,s.name AS raw_school_name,s.location_matched_name,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
      s.city,s.state,s.address,s.postal_code
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    ORDER BY s.city,school_name,t.id
  `).all();
  if(rowsWritten(result)!==0) throw new Error("M7 identity catalog wrote to D1");
  return {d1:{statements:1,rows_read:rowsRead(result),rows_written:0},teams:result.results||[]};
}
