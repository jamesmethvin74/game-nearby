import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import {
  certifiedTargetSchoolIds,
  discoverCertifiedSportParticipants,
  syncCertifiedDragonFlySportCatalog
} from "./dragonfly-certified-sport-catalog.js";
import { runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig, STATEWIDE_HIGH_SCHOOL_SPORTS } from "./statewide-sport-config.js";

export const M2_BOOTSTRAP_V3_READY_PATH="/api/v1/_m2-bootstrap-v3-ready-20260903";
export const M2_BOOTSTRAP_V3_SPORT_PREFIX="/api/v1/_m2-bootstrap-v3-sport-20260903/";
export const M2_BOOTSTRAP_V3_VERIFY_PATH="/api/v1/_m2-bootstrap-v3-verify-20260903-1102";
const HEADER="x-localbleachers-m2-bootstrap";
const HEADER_VALUE="approved-certified-1102-20260903";
const SINCE_HEADER="x-localbleachers-m2-bootstrap-since";
const PROTECTION_INDEXES=[
  "idx_canonical_members_reporting_team",
  "idx_games_team_record_lookup",
  "idx_games_source_time",
  "idx_games_opponent_time",
  "idx_sources_enabled_checked"
];

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function authorized(request){
  return request.headers.get(HEADER)===HEADER_VALUE;
}

function validatedSince(request){
  const raw=String(request.headers.get(SINCE_HEADER)||"").trim();
  const ms=Date.parse(raw);
  if (!raw || !Number.isFinite(ms)) throw new Error("valid bootstrap since timestamp is required");
  return new Date(ms).toISOString();
}

async function runOneSport(env,teamCode){
  const config=statewideSportConfig(teamCode);
  const startedAt=new Date().toISOString();
  let stage="provider-fetch";
  const output={
    key:config.key,
    teamCode:config.teamCode,
    expectedTargets:config.expectedTargets,
    startedAt,
    provider:null,
    catalog:null,
    collection:null
  };
  try {
    const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{
      headers:{"user-agent":"LocalBleachersAR-M2-production-bootstrap-v3/1.0","accept":"application/json"}
    });
    const payload=fetched.payload;
    const events=Array.isArray(payload?.schedule)?payload.schedule.length:0;
    const certified=certifiedTargetSchoolIds(config);
    const entries=discoverCertifiedSportParticipants(payload,config);
    const discoveredCertified=new Set(
      entries.filter(entry=>certified.has(entry.externalSchoolId)).map(entry=>entry.externalSchoolId)
    );
    output.provider={
      feedCode:config.feedCode,
      pagesFetched:fetched.pageCount,
      events,
      discoveredCertifiedTargets:discoveredCertified.size
    };
    if (events<config.minEvents) throw new Error(`${config.feedCode} returned ${events} events; minimum is ${config.minEvents}`);
    if (discoveredCertified.size!==config.expectedTargets) {
      throw new Error(`${config.feedCode} exposes ${discoveredCertified.size}/${config.expectedTargets} certified targets`);
    }

    // This catalog operation is the per-sport pre-write guard: it refuses to
    // execute its batch unless every certified target resolves to the existing
    // certified school/team and no external-team identity collision is found.
    stage="catalog";
    const catalog=await syncCertifiedDragonFlySportCatalog(env,config,{payload,force:true});
    output.catalog={
      status:catalog.status,
      mapped:catalog.mapped,
      mappedSchools:catalog.mappedSchools,
      statewideSources:catalog.statewideSources,
      missingCertifiedTargets:catalog.missingCertifiedTargets,
      quarantined:catalog.quarantined
    };
    if (catalog.status!=="SUCCESS"
      || catalog.mappedSchools!==config.expectedTargets
      || catalog.statewideSources!==config.expectedTargets
      || catalog.missingCertifiedTargets!==0) {
      throw new Error(`${config.teamCode} catalog did not resolve the full certified target set`);
    }

    stage="collection";
    // WVB has a pre-M2 collection-state signature on the same feed. Giving only
    // this one bootstrap call a distinct signature key forces materialization
    // into the new exact M2 source rows. The normal scheduler will subsequently
    // settle the state back to the ordinary config signature.
    const collectionConfig=config.teamCode==="WVB"
      ? {...config,key:`${config.key}-bootstrap-v3`}
      : config;
    const collection=await runCertifiedDragonFlyStatewideCollection(env,collectionConfig,{payload});
    output.collection={
      status:collection.status,
      events:collection.rawEventCount,
      observations:collection.observations,
      canonicalEvents:collection.canonicalEvents,
      sources:collection.sources,
      touchedTeams:collection.touchedTeams,
      recordRebuild:collection.recordRebuild||null
    };
    if (collection.status!=="SUCCESS") throw new Error(`${config.teamCode} collection did not perform the bootstrap materialization`);
    if (Number(collection.sources)!==config.expectedTargets) {
      throw new Error(`${config.teamCode} collection used ${collection.sources}/${config.expectedTargets} certified sources`);
    }
    if (Number(collection.observations||0)<=0) throw new Error(`${config.teamCode} collection produced no observations`);

    return {status:"SUCCESS",stage:"complete",...output,completedAt:new Date().toISOString()};
  } catch(error) {
    return {status:"FAILURE",stage,...output,error:String(error?.message||error),failedAt:new Date().toISOString()};
  }
}

async function verifyAllSports(env,since){
  const configs=STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>({
    key:config.key,
    teamCode:config.teamCode,
    sport:config.sport,
    gender:config.gender,
    season:config.season,
    expectedTargets:config.expectedTargets,
    minEvents:config.minEvents,
    catalogSyncId:config.catalogSyncId,
    stateId:config.stateId
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
        CAST(json_extract(value,'$.minEvents') AS INTEGER) AS min_events,
        json_extract(value,'$.catalogSyncId') AS catalog_id,
        json_extract(value,'$.stateId') AS state_id
      FROM json_each(?)
    ),
    sport_status AS (
      SELECT
        c.key,c.team_code,c.expected_targets,c.min_events,
        (SELECT last_successful_sync_at FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_success_at,
        (SELECT last_error FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_error,
        (SELECT CAST(json_extract(details_json,'$.mappedSchools') AS INTEGER) FROM catalog_sync_state WHERE id=c.catalog_id) AS mapped_schools,
        (SELECT CAST(json_extract(details_json,'$.statewideSources') AS INTEGER) FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_sources,
        (SELECT last_successful_fetch_at FROM statewide_collection_state WHERE id=c.state_id) AS collection_success_at,
        (SELECT last_error FROM statewide_collection_state WHERE id=c.state_id) AS collection_error,
        (SELECT last_event_count FROM statewide_collection_state WHERE id=c.state_id) AS event_count,
        (SELECT last_observation_count FROM statewide_collection_state WHERE id=c.state_id) AS observation_count,
        (SELECT last_source_count FROM statewide_collection_state WHERE id=c.state_id) AS collection_sources,
        (SELECT COUNT(*)
           FROM sources src
           JOIN teams t ON t.id=src.team_id
          WHERE t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season
            AND src.parser_type='dragonfly-public'
            AND src.collection_mode='statewide'
            AND src.id=t.id || '-dragonfly-statewide') AS exact_source_rows,
        (SELECT COUNT(DISTINCT t.id)
           FROM sources src
           JOIN teams t ON t.id=src.team_id
           JOIN team_external_identities tei ON tei.team_id=t.id AND tei.provider='dragonfly'
          WHERE t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season
            AND src.parser_type='dragonfly-public'
            AND src.collection_mode='statewide'
            AND src.id=t.id || '-dragonfly-statewide') AS source_teams_with_identity,
        (SELECT COUNT(DISTINCT tr.team_id)
           FROM sources src
           JOIN teams t ON t.id=src.team_id
           JOIN team_records tr ON tr.team_id=t.id
          WHERE t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season
            AND src.parser_type='dragonfly-public'
            AND src.collection_mode='statewide'
            AND src.id=t.id || '-dragonfly-statewide') AS record_teams,
        (SELECT COUNT(*)
           FROM sources src
           JOIN teams t ON t.id=src.team_id
          WHERE t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season
            AND src.parser_type='dragonfly-public'
            AND src.collection_mode='statewide'
            AND src.id=t.id || '-dragonfly-statewide'
            AND src.enabled=1) AS enabled_exact_sources
      FROM cfg c
    )
    SELECT ss.*,
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name IN (
        'idx_canonical_members_reporting_team',
        'idx_games_team_record_lookup',
        'idx_games_source_time',
        'idx_games_opponent_time',
        'idx_sources_enabled_checked'
      )) AS protection_index_count,
      (SELECT COUNT(*) FROM sources WHERE collection_mode='statewide' AND enabled=1) AS enabled_statewide_sources
    FROM sport_status ss
    ORDER BY CASE ss.team_code
      WHEN 'FB' THEN 1 WHEN 'MBB' THEN 2 WHEN 'WBB' THEN 3
      WHEN 'MSO' THEN 4 WHEN 'WSO' THEN 5 WHEN 'WVB' THEN 6 ELSE 99 END
  `).bind(JSON.stringify(configs)).all();

  const sinceMs=Date.parse(since);
  const sports=(result.results||[]).map(row=>({
    key:row.key,
    teamCode:row.team_code,
    expectedTargets:Number(row.expected_targets||0),
    minEvents:Number(row.min_events||0),
    catalogSuccessAt:row.catalog_success_at||null,
    catalogError:row.catalog_error||null,
    mappedSchools:Number(row.mapped_schools||0),
    catalogSources:Number(row.catalog_sources||0),
    collectionSuccessAt:row.collection_success_at||null,
    collectionError:row.collection_error||null,
    eventCount:Number(row.event_count||0),
    observations:Number(row.observation_count||0),
    collectionSources:Number(row.collection_sources||0),
    exactSourceRows:Number(row.exact_source_rows||0),
    sourceTeamsWithIdentity:Number(row.source_teams_with_identity||0),
    recordTeams:Number(row.record_teams||0),
    enabledExactSources:Number(row.enabled_exact_sources||0)
  }));
  const first=result.results?.[0]||{};
  const global={
    protectionIndexCount:Number(first.protection_index_count||0),
    enabledStatewideSources:Number(first.enabled_statewide_sources||0)
  };

  const complete=sports.length===6 && sports.every(item=>{
    const catalogMs=Date.parse(item.catalogSuccessAt||"");
    const collectionMs=Date.parse(item.collectionSuccessAt||"");
    return item.catalogError===null
      && item.collectionError===null
      && Number.isFinite(catalogMs) && catalogMs>=sinceMs
      && Number.isFinite(collectionMs) && collectionMs>=sinceMs
      && item.mappedSchools===item.expectedTargets
      && item.catalogSources===item.expectedTargets
      && item.collectionSources===item.expectedTargets
      && item.exactSourceRows===item.expectedTargets
      && item.sourceTeamsWithIdentity===item.expectedTargets
      && item.recordTeams===item.expectedTargets
      && item.eventCount>=item.minEvents
      && item.observations>0
      && item.enabledExactSources===0;
  }) && global.protectionIndexCount===5 && global.enabledStatewideSources===0;

  return {
    status:complete?"SUCCESS":"INCOMPLETE",
    complete,
    since,
    sports,
    totals:{
      expectedTargets:sports.reduce((sum,item)=>sum+item.expectedTargets,0),
      exactSourceRows:sports.reduce((sum,item)=>sum+item.exactSourceRows,0),
      sourceTeamsWithIdentity:sports.reduce((sum,item)=>sum+item.sourceTeamsWithIdentity,0),
      recordTeams:sports.reduce((sum,item)=>sum+item.recordTeams,0),
      observations:sports.reduce((sum,item)=>sum+item.observations,0),
      enabledExactSources:sports.reduce((sum,item)=>sum+item.enabledExactSources,0)
    },
    global,
    expectedProtectionIndexes:PROTECTION_INDEXES,
    d1Meta:{
      rowsRead:Number(result.meta?.rows_read||0),
      rowsWritten:Number(result.meta?.rows_written||0),
      durationMs:Number(result.meta?.duration||0)||null
    }
  };
}

export async function maybeHandleM2ProductionBootstrapV3(request,env){
  const url=new URL(request.url);
  if (request.method!=="GET") return null;
  if (url.pathname===M2_BOOTSTRAP_V3_READY_PATH) {
    return json({ready:true,release:"m2-production-bootstrap-per-sport-v3-20260903"});
  }
  if (!authorized(request)) {
    if (url.pathname.startsWith(M2_BOOTSTRAP_V3_SPORT_PREFIX) || url.pathname===M2_BOOTSTRAP_V3_VERIFY_PATH) return json({error:"not_found"},404);
    return null;
  }
  if (url.pathname.startsWith(M2_BOOTSTRAP_V3_SPORT_PREFIX)) {
    const code=decodeURIComponent(url.pathname.slice(M2_BOOTSTRAP_V3_SPORT_PREFIX.length)).toUpperCase();
    try {
      const result=await runOneSport(env,code);
      return json(result,result.status==="SUCCESS"?200:409);
    } catch(error) {
      return json({status:"FAILURE",stage:"route",teamCode:code,error:String(error?.message||error)},400);
    }
  }
  if (url.pathname===M2_BOOTSTRAP_V3_VERIFY_PATH) {
    try {
      const since=validatedSince(request);
      const result=await verifyAllSports(env,since);
      return json(result,result.complete?200:409);
    } catch(error) {
      return json({status:"FAILURE",stage:"verification",error:String(error?.message||error)},400);
    }
  }
  return null;
}
