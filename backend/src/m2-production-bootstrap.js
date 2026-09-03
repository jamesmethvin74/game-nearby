import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import {
  certifiedTargetSchoolIds,
  discoverCertifiedSportParticipants,
  syncCertifiedDragonFlySportCatalog
} from "./dragonfly-certified-sport-catalog.js";
import { runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { STATEWIDE_HIGH_SCHOOL_SPORTS } from "./statewide-sport-config.js";

export const M2_BOOTSTRAP_READY_PATH="/api/v1/_m2-bootstrap-ready-20260903";
export const M2_BOOTSTRAP_RUN_PATH="/api/v1/_m2-bootstrap-run-20260903-1102";
const HEADER="x-localbleachers-m2-bootstrap";
const HEADER_VALUE="approved-certified-1102-20260903";
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

function expectedTotal(){
  return STATEWIDE_HIGH_SCHOOL_SPORTS.reduce((sum,config)=>sum+config.expectedTargets,0);
}

async function fetchAndValidateAllFeeds(){
  const payloads=new Map();
  const providerFetch=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{
      headers:{"user-agent":"LocalBleachersAR-M2-production-bootstrap/2.0","accept":"application/json"}
    });
    const payload=fetched.payload;
    const entries=discoverCertifiedSportParticipants(payload,config);
    const certified=certifiedTargetSchoolIds(config);
    const discoveredCertified=new Set(entries.filter(entry=>certified.has(entry.externalSchoolId)).map(entry=>entry.externalSchoolId));
    const events=Array.isArray(payload?.schedule)?payload.schedule.length:0;
    if (events<config.minEvents) throw new Error(`${config.feedCode} returned ${events} events; minimum is ${config.minEvents}`);
    if (discoveredCertified.size!==config.expectedTargets) {
      throw new Error(`${config.feedCode} exposes ${discoveredCertified.size}/${config.expectedTargets} certified targets`);
    }
    payloads.set(config.key,payload);
    providerFetch.push({
      key:config.key,feedCode:config.feedCode,pagesFetched:fetched.pageCount,events,
      expectedTargets:config.expectedTargets,discoveredCertifiedTargets:discoveredCertified.size
    });
  }
  return {payloads,providerFetch};
}

async function preflightProductionMappings(env,payloads){
  const planned=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const certified=certifiedTargetSchoolIds(config);
    for (const entry of discoverCertifiedSportParticipants(payloads.get(config.key),config)) {
      if (!certified.has(entry.externalSchoolId)) continue;
      planned.push({
        external_school_id:entry.externalSchoolId,
        team_code:config.teamCode,
        sport:config.sport,
        gender:config.gender,
        season:config.season,
        external_team_id:entry.externalTeamId
      });
    }
  }

  // Keep exact equality on provider/external IDs so the existing unique/indexed
  // lookup path is usable. The previous UPPER(column) predicate defeated it and
  // caused the D1 CPU reset before any bootstrap writes occurred.
  const result=await env.DB.prepare(`
    WITH planned AS (
      SELECT
        json_extract(value,'$.external_school_id') AS external_school_id,
        json_extract(value,'$.team_code') AS team_code,
        json_extract(value,'$.sport') AS sport,
        json_extract(value,'$.gender') AS gender,
        json_extract(value,'$.season') AS season,
        json_extract(value,'$.external_team_id') AS external_team_id
      FROM json_each(?)
    ),
    resolved AS (
      SELECT p.external_school_id,p.team_code,p.external_team_id,t.id AS team_id
      FROM planned p
      JOIN school_external_identities sei
        ON sei.provider='dragonfly' AND sei.external_school_id=p.external_school_id
      JOIN teams t
        ON t.school_id=sei.school_id
       AND t.active=1
       AND t.sport=p.sport
       AND t.gender=p.gender
       AND t.season=p.season
    )
    SELECT
      (SELECT COUNT(*) FROM (SELECT DISTINCT external_school_id,team_code FROM planned)) AS planned_targets,
      (SELECT COUNT(*) FROM (SELECT DISTINCT external_school_id,team_code FROM resolved)) AS resolved_targets,
      (SELECT COUNT(*) FROM resolved r
        JOIN team_external_identities tei
          ON tei.provider='dragonfly' AND tei.external_team_id=r.external_team_id
        WHERE tei.team_id<>r.team_id) AS external_team_identity_collisions
  `).bind(JSON.stringify(planned)).all();
  const row=result.results?.[0]||{};
  const summary={
    expectedTargets:expectedTotal(),
    plannedTargets:Number(row.planned_targets||0),
    resolvedTargets:Number(row.resolved_targets||0),
    externalTeamIdentityCollisions:Number(row.external_team_identity_collisions||0),
    d1Meta:{
      rowsRead:Number(result.meta?.rows_read||0),rowsWritten:Number(result.meta?.rows_written||0),durationMs:Number(result.meta?.duration||0)||null
    }
  };
  summary.safe=summary.expectedTargets===1102
    && summary.plannedTargets===1102
    && summary.resolvedTargets===1102
    && summary.externalTeamIdentityCollisions===0;
  return summary;
}

async function verifyProductionBootstrap(env,startedAt){
  const configs=STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>({
    key:config.key,teamCode:config.teamCode,sport:config.sport,gender:config.gender,season:config.season,
    expectedTargets:config.expectedTargets,minEvents:config.minEvents,catalogSyncId:config.catalogSyncId,stateId:config.stateId
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
    )
    SELECT
      c.key,c.team_code,c.expected_targets,c.min_events,
      (SELECT last_successful_sync_at FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_success_at,
      (SELECT last_error FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_error,
      (SELECT CAST(json_extract(details_json,'$.mappedSchools') AS INTEGER) FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_mapped_schools,
      (SELECT CAST(json_extract(details_json,'$.statewideSources') AS INTEGER) FROM catalog_sync_state WHERE id=c.catalog_id) AS catalog_statewide_sources,
      (SELECT last_successful_fetch_at FROM statewide_collection_state WHERE id=c.state_id) AS collection_success_at,
      (SELECT last_error FROM statewide_collection_state WHERE id=c.state_id) AS collection_error,
      (SELECT last_event_count FROM statewide_collection_state WHERE id=c.state_id) AS last_event_count,
      (SELECT last_observation_count FROM statewide_collection_state WHERE id=c.state_id) AS last_observation_count,
      (SELECT last_source_count FROM statewide_collection_state WHERE id=c.state_id) AS last_source_count,
      (SELECT COUNT(DISTINCT t.id) FROM teams t
        JOIN sources src ON src.team_id=t.id
        WHERE t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season
          AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'
          AND src.id=t.id || '-dragonfly-statewide') AS exact_source_rows,
      (SELECT COUNT(DISTINCT t.id) FROM teams t
        JOIN team_external_identities tei ON tei.team_id=t.id AND tei.provider='dragonfly'
        WHERE t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season) AS identity_teams,
      (SELECT COUNT(*) FROM sources src
        JOIN teams t ON t.id=src.team_id
        WHERE t.active=1 AND t.sport=c.sport AND t.gender=c.gender AND t.season=c.season
          AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' AND src.enabled=1) AS enabled_exact_sources,
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name IN (
        'idx_canonical_members_reporting_team','idx_games_team_record_lookup','idx_games_source_time','idx_games_opponent_time','idx_sources_enabled_checked'
      )) AS protection_index_count,
      (SELECT COUNT(*) FROM sources WHERE collection_mode='statewide' AND enabled=1) AS enabled_statewide_sources
    FROM cfg c
    ORDER BY CASE c.team_code
      WHEN 'FB' THEN 1 WHEN 'MBB' THEN 2 WHEN 'WBB' THEN 3
      WHEN 'MSO' THEN 4 WHEN 'WSO' THEN 5 WHEN 'WVB' THEN 6 ELSE 99 END
  `).bind(JSON.stringify(configs)).all();

  const startedMs=Date.parse(startedAt);
  const sports=(result.results||[]).map(row=>({
    key:row.key,teamCode:row.team_code,expectedTargets:Number(row.expected_targets||0),minEvents:Number(row.min_events||0),
    catalogSuccessAt:row.catalog_success_at||null,catalogError:row.catalog_error||null,
    catalogMappedSchools:Number(row.catalog_mapped_schools||0),catalogStatewideSources:Number(row.catalog_statewide_sources||0),
    collectionSuccessAt:row.collection_success_at||null,collectionError:row.collection_error||null,
    lastEventCount:Number(row.last_event_count||0),lastObservationCount:Number(row.last_observation_count||0),lastSourceCount:Number(row.last_source_count||0),
    exactSourceRows:Number(row.exact_source_rows||0),identityTeams:Number(row.identity_teams||0),enabledExactSources:Number(row.enabled_exact_sources||0)
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
      && Number.isFinite(catalogMs) && catalogMs>=startedMs
      && Number.isFinite(collectionMs) && collectionMs>=startedMs
      && item.catalogMappedSchools===item.expectedTargets
      && item.catalogStatewideSources===item.expectedTargets
      && item.exactSourceRows===item.expectedTargets
      && item.identityTeams===item.expectedTargets
      && item.enabledExactSources===0
      && item.lastSourceCount===item.expectedTargets
      && item.lastEventCount>=item.minEvents
      && item.lastObservationCount>0;
  }) && global.protectionIndexCount===5 && global.enabledStatewideSources===0;

  return {
    complete,
    sports,
    totals:{
      expectedTargets:sports.reduce((n,item)=>n+item.expectedTargets,0),
      exactSourceRows:sports.reduce((n,item)=>n+item.exactSourceRows,0),
      identityTeams:sports.reduce((n,item)=>n+item.identityTeams,0),
      observations:sports.reduce((n,item)=>n+item.lastObservationCount,0),
      enabledExactSources:sports.reduce((n,item)=>n+item.enabledExactSources,0)
    },
    global,
    expectedProtectionIndexes:PROTECTION_INDEXES,
    d1Meta:{
      rowsRead:Number(result.meta?.rows_read||0),rowsWritten:Number(result.meta?.rows_written||0),durationMs:Number(result.meta?.duration||0)||null
    }
  };
}

export async function runM2ProductionBootstrap(env){
  const startedAt=new Date().toISOString();
  const output={startedAt,providerFetch:[],preflight:null,catalogs:[],collections:[],verification:null};
  let stage="provider-prefetch";
  try {
    const fetched=await fetchAndValidateAllFeeds();
    const payloads=fetched.payloads;
    output.providerFetch=fetched.providerFetch;

    stage="d1-preflight";
    output.preflight=await preflightProductionMappings(env,payloads);
    if (!output.preflight.safe) {
      return {status:"PREFLIGHT_FAILED",stage,...output,completedAt:new Date().toISOString()};
    }

    for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
      stage=`catalog:${config.key}`;
      const result=await syncCertifiedDragonFlySportCatalog(env,config,{payload:payloads.get(config.key),force:true});
      output.catalogs.push({
        key:config.key,status:result.status,mapped:result.mapped,mappedSchools:result.mappedSchools,
        statewideSources:result.statewideSources,missingCertifiedTargets:result.missingCertifiedTargets,quarantined:result.quarantined
      });
    }

    try {
      for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
        stage=`collection:${config.key}`;
        const result=await runCertifiedDragonFlyStatewideCollection(env,config,{payload:payloads.get(config.key)});
        output.collections.push({
          key:config.key,status:result.status,events:result.rawEventCount,observations:result.observations,
          canonicalEvents:result.canonicalEvents,sources:result.sources,touchedTeams:result.touchedTeams,recordRebuild:result.recordRebuild||null
        });
      }
    } finally {
      stage="disable-statewide-sources";
      await env.DB.prepare("UPDATE sources SET enabled=0 WHERE collection_mode='statewide'").run();
    }

    stage="verification";
    output.verification=await verifyProductionBootstrap(env,startedAt);
    return {
      status:output.verification.complete?"SUCCESS":"VERIFICATION_INCOMPLETE",
      stage,
      ...output,
      completedAt:new Date().toISOString()
    };
  } catch (error) {
    return {
      status:"FAILURE",stage,...output,error:String(error?.message||error),failedAt:new Date().toISOString()
    };
  }
}

export async function maybeHandleM2ProductionBootstrap(request,env){
  const url=new URL(request.url);
  if (request.method!=="GET") return null;
  if (url.pathname===M2_BOOTSTRAP_READY_PATH) return json({ready:true,release:"m2-production-bootstrap-20260903-v2"});
  if (url.pathname!==M2_BOOTSTRAP_RUN_PATH) return null;
  if (request.headers.get(HEADER)!==HEADER_VALUE) return json({error:"not_found"},404);
  const result=await runM2ProductionBootstrap(env);
  return json(result,result.status==="SUCCESS"?200:409);
}
