import { STATEWIDE_HIGH_SCHOOL_SPORTS } from "./statewide-sport-config.js";

export const M2_BOOTSTRAP_STATUS_PATH="/api/v1/_m2-bootstrap-status-20260903-1102";
const HEADER="x-localbleachers-m2-bootstrap";
const HEADER_VALUE="approved-certified-1102-20260903";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

export async function readM2BootstrapStatus(env){
  const configs=STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>({
    key:config.key,teamCode:config.teamCode,sport:config.sport,gender:config.gender,season:config.season,
    expectedTargets:config.expectedTargets,catalogSyncId:config.catalogSyncId,stateId:config.stateId
  }));
  const result=await env.DB.prepare(`
    WITH cfg AS (
      SELECT
        json_extract(value,'$.key') AS key,
        json_extract(value,'$.teamCode') AS team_code,
        json_extract(value,'$.sport') AS sport,
        json_extract(value,'$.gender') AS gender,
        json_extract(value,'$.season') AS season,
        CAST(json_extract(value,'$.expectedTargets') AS INTEGER) AS expected_targets,
        json_extract(value,'$.catalogSyncId') AS catalog_id,
        json_extract(value,'$.stateId') AS state_id
      FROM json_each(?)
    )
    SELECT
      c.key,c.team_code,c.expected_targets,
      (SELECT last_successful_sync_at FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_success_at,
      (SELECT last_error FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_error,
      (SELECT CAST(json_extract(details_json,'$.mappedSchools') AS INTEGER) FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_mapped_schools,
      (SELECT CAST(json_extract(details_json,'$.statewideSources') AS INTEGER) FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_statewide_sources,
      (SELECT last_successful_fetch_at FROM statewide_collection_state WHERE id=c.state_id) AS collection_success_at,
      (SELECT last_error FROM statewide_collection_state WHERE id=c.state_id) AS collection_error,
      (SELECT last_event_count FROM statewide_collection_state WHERE id=c.state_id) AS last_event_count,
      (SELECT last_observation_count FROM statewide_collection_state WHERE id=c.state_id) AS last_observation_count,
      (SELECT last_source_count FROM statewide_collection_state WHERE id=c.state_id) AS last_source_count,
      (SELECT COUNT(*) FROM sources src
        JOIN teams t ON t.id=src.team_id
        WHERE src.collection_mode='statewide'
          AND src.parser_type='dragonfly-public'
          AND src.id=t.id || '-dragonfly-statewide'
          AND t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season) AS exact_source_rows,
      (SELECT COUNT(*) FROM sources src
        JOIN teams t ON t.id=src.team_id
        WHERE src.collection_mode='statewide'
          AND src.parser_type='dragonfly-public'
          AND src.id=t.id || '-dragonfly-statewide'
          AND src.enabled=1
          AND t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season) AS enabled_exact_sources
    FROM cfg c
    ORDER BY CASE c.team_code
      WHEN 'FB' THEN 1 WHEN 'MBB' THEN 2 WHEN 'WBB' THEN 3
      WHEN 'MSO' THEN 4 WHEN 'WSO' THEN 5 WHEN 'WVB' THEN 6 ELSE 99 END
  `).bind(JSON.stringify(configs)).all();

  const sports=(result.results||[]).map(row=>({
    key:row.key,teamCode:row.team_code,expectedTargets:Number(row.expected_targets||0),
    catalogSuccessAt:row.catalog_success_at||null,catalogError:row.catalog_error||null,
    catalogMappedSchools:Number(row.catalog_mapped_schools||0),catalogStatewideSources:Number(row.catalog_statewide_sources||0),
    collectionSuccessAt:row.collection_success_at||null,collectionError:row.collection_error||null,
    lastEventCount:Number(row.last_event_count||0),lastObservationCount:Number(row.last_observation_count||0),lastSourceCount:Number(row.last_source_count||0),
    exactSourceRows:Number(row.exact_source_rows||0),enabledExactSources:Number(row.enabled_exact_sources||0)
  }));
  return {
    sports,
    totals:{
      expectedTargets:sports.reduce((n,item)=>n+item.expectedTargets,0),
      exactSourceRows:sports.reduce((n,item)=>n+item.exactSourceRows,0),
      successfulCatalogs:sports.filter(item=>item.catalogSuccessAt && !item.catalogError).length,
      successfulCollections:sports.filter(item=>item.collectionSuccessAt && !item.collectionError).length,
      enabledExactSources:sports.reduce((n,item)=>n+item.enabledExactSources,0)
    },
    d1Meta:{
      rowsRead:Number(result.meta?.rows_read||0),rowsWritten:Number(result.meta?.rows_written||0),durationMs:Number(result.meta?.duration||0)||null
    }
  };
}

export async function maybeHandleM2BootstrapStatus(request,env){
  const url=new URL(request.url);
  if (request.method!=="GET" || url.pathname!==M2_BOOTSTRAP_STATUS_PATH) return null;
  if (request.headers.get(HEADER)!==HEADER_VALUE) return json({error:"not_found"},404);
  try { return json(await readM2BootstrapStatus(env)); }
  catch (error) { return json({error:"status_probe_failed",message:String(error?.message||error)},500); }
}
