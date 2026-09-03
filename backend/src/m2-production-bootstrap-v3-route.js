import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import {
  certifiedTargetSchoolIds,
  discoverCertifiedSportParticipants,
  syncCertifiedDragonFlySportCatalog
} from "./dragonfly-certified-sport-catalog.js";
import { runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { STATEWIDE_HIGH_SCHOOL_SPORTS, statewideSportConfig } from "./statewide-sport-config.js";

export const M2_BOOTSTRAP_V3_READY_PATH="/api/v1/_m2-bootstrap-v3-ready-20260903";
const PREFLIGHT_PREFIX="/api/v1/_m2-bootstrap-v3-preflight-20260903-";
const RUN_PREFIX="/api/v1/_m2-bootstrap-v3-run-20260903-";
export const M2_BOOTSTRAP_V3_VERIFY_PATH="/api/v1/_m2-bootstrap-v3-verify-20260903";
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

function configFromPath(path,prefix){
  if (!path.startsWith(prefix)) return null;
  const code=decodeURIComponent(path.slice(prefix.length)).trim().toUpperCase();
  if (!code) return null;
  try { return statewideSportConfig(code); }
  catch { return null; }
}

async function fetchAndValidateSport(config){
  const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{
    headers:{"user-agent":"LocalBleachersAR-M2-production-bootstrap/3.0","accept":"application/json"}
  });
  const payload=fetched.payload;
  const entries=discoverCertifiedSportParticipants(payload,config);
  const certified=certifiedTargetSchoolIds(config);
  const certifiedEntries=entries.filter(entry=>certified.has(entry.externalSchoolId));
  const discoveredSchools=new Set(certifiedEntries.map(entry=>entry.externalSchoolId));
  const events=Array.isArray(payload?.schedule)?payload.schedule.length:0;
  if (events<config.minEvents) throw new Error(`${config.feedCode} returned ${events} events; minimum is ${config.minEvents}`);
  if (discoveredSchools.size!==config.expectedTargets) {
    throw new Error(`${config.feedCode} exposes ${discoveredSchools.size}/${config.expectedTargets} certified targets`);
  }
  return {payload,entries:certifiedEntries,certified,pagesFetched:fetched.pageCount,events};
}

function addMeta(total,result){
  total.rowsRead+=Number(result?.meta?.rows_read||0);
  total.rowsWritten+=Number(result?.meta?.rows_written||0);
  total.durationMs+=Number(result?.meta?.duration||0);
}

async function sportPreflight(env,config,fetched=null){
  const validated=fetched||await fetchAndValidateSport(config);
  const externalSchoolIds=[...validated.certified];
  const externalTeamIds=[...new Set(validated.entries.map(entry=>entry.externalTeamId))];
  const meta={rowsRead:0,rowsWritten:0,durationMs:0};

  const identities=await env.DB.prepare(`
    SELECT external_school_id,school_id
    FROM school_external_identities
    WHERE provider='dragonfly'
      AND external_school_id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(externalSchoolIds)).all();
  addMeta(meta,identities);
  const schoolByExternal=new Map((identities.results||[]).map(row=>[String(row.external_school_id).toUpperCase(),row.school_id]));
  const schoolIds=[...new Set(schoolByExternal.values())];

  const teams=await env.DB.prepare(`
    SELECT id,school_id
    FROM teams
    WHERE active=1 AND sport=? AND gender=? AND season=?
      AND school_id IN (SELECT value FROM json_each(?))
  `).bind(config.sport,config.gender,config.season,JSON.stringify(schoolIds)).all();
  addMeta(meta,teams);
  const teamBySchool=new Map((teams.results||[]).map(row=>[row.school_id,row.id]));

  const existing=externalTeamIds.length ? await env.DB.prepare(`
    SELECT external_team_id,team_id
    FROM team_external_identities
    WHERE provider='dragonfly'
      AND external_team_id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(externalTeamIds)).all() : {results:[],meta:{}};
  addMeta(meta,existing);
  const existingByExternal=new Map((existing.results||[]).map(row=>[String(row.external_team_id),row.team_id]));

  let collisions=0;
  const missingSchoolIds=[];
  const missingTeamSchoolIds=[];
  for (const externalSchoolId of externalSchoolIds) {
    const schoolId=schoolByExternal.get(externalSchoolId);
    if (!schoolId) {
      missingSchoolIds.push(externalSchoolId);
      continue;
    }
    if (!teamBySchool.has(schoolId)) missingTeamSchoolIds.push(externalSchoolId);
  }
  for (const entry of validated.entries) {
    const schoolId=schoolByExternal.get(entry.externalSchoolId);
    const teamId=schoolId?teamBySchool.get(schoolId):null;
    const existingTeamId=existingByExternal.get(entry.externalTeamId);
    if (existingTeamId && teamId && existingTeamId!==teamId) collisions++;
  }

  const resolvedTargets=externalSchoolIds.length-missingSchoolIds.length-missingTeamSchoolIds.length;
  const summary={
    key:config.key,
    teamCode:config.teamCode,
    feedCode:config.feedCode,
    expectedTargets:config.expectedTargets,
    provider:{pagesFetched:validated.pagesFetched,events:validated.events,discoveredCertifiedTargets:externalSchoolIds.length},
    identityRows:schoolByExternal.size,
    teamRows:teamBySchool.size,
    resolvedTargets,
    externalTeamIds:externalTeamIds.length,
    externalTeamIdentityCollisions:collisions,
    missingSchoolIds:missingSchoolIds.slice(0,25),
    missingTeamSchoolIds:missingTeamSchoolIds.slice(0,25),
    d1Meta:meta
  };
  summary.safe=summary.provider.discoveredCertifiedTargets===config.expectedTargets
    && summary.identityRows===config.expectedTargets
    && summary.teamRows===config.expectedTargets
    && summary.resolvedTargets===config.expectedTargets
    && collisions===0;
  return {summary,validated};
}

async function runSport(env,config){
  const preflight=await sportPreflight(env,config);
  if (!preflight.summary.safe) {
    return {status:"PREFLIGHT_FAILED",preflight:preflight.summary};
  }
  const catalog=await syncCertifiedDragonFlySportCatalog(env,config,{payload:preflight.validated.payload,force:true});
  const collection=await runCertifiedDragonFlyStatewideCollection(env,config,{payload:preflight.validated.payload});
  await env.DB.prepare("UPDATE sources SET enabled=0 WHERE collection_mode='statewide' AND enabled<>0").run();
  return {
    status:"SUCCESS",
    key:config.key,
    teamCode:config.teamCode,
    preflight:preflight.summary,
    catalog:{
      status:catalog.status,mapped:catalog.mapped,mappedSchools:catalog.mappedSchools,
      statewideSources:catalog.statewideSources,missingCertifiedTargets:catalog.missingCertifiedTargets,
      quarantined:catalog.quarantined
    },
    collection:{
      status:collection.status,events:collection.rawEventCount,observations:collection.observations,
      canonicalEvents:collection.canonicalEvents,sources:collection.sources,touchedTeams:collection.touchedTeams,
      recordRebuild:collection.recordRebuild||null
    }
  };
}

async function verifyAll(env){
  const sports=[];
  const meta={rowsRead:0,rowsWritten:0,durationMs:0};
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const state=await env.DB.prepare(`
      SELECT
        (SELECT last_successful_sync_at FROM catalog_sync_state WHERE id=?) AS catalog_success_at,
        (SELECT last_error FROM catalog_sync_state WHERE id=?) AS catalog_error,
        (SELECT CAST(json_extract(details_json,'$.mappedSchools') AS INTEGER) FROM catalog_sync_state WHERE id=?) AS mapped_schools,
        (SELECT CAST(json_extract(details_json,'$.statewideSources') AS INTEGER) FROM catalog_sync_state WHERE id=?) AS statewide_sources,
        (SELECT last_successful_fetch_at FROM statewide_collection_state WHERE id=?) AS collection_success_at,
        (SELECT last_error FROM statewide_collection_state WHERE id=?) AS collection_error,
        (SELECT last_event_count FROM statewide_collection_state WHERE id=?) AS last_event_count,
        (SELECT last_observation_count FROM statewide_collection_state WHERE id=?) AS last_observation_count,
        (SELECT last_source_count FROM statewide_collection_state WHERE id=?) AS last_source_count
    `).bind(
      config.catalogSyncId,config.catalogSyncId,config.catalogSyncId,config.catalogSyncId,
      config.stateId,config.stateId,config.stateId,config.stateId,config.stateId
    ).all();
    addMeta(meta,state);
    const counts=await env.DB.prepare(`
      SELECT
        COUNT(DISTINCT t.id) AS exact_source_rows,
        COUNT(DISTINCT CASE WHEN tei.provider='dragonfly' THEN t.id END) AS identity_teams,
        SUM(CASE WHEN src.enabled=1 THEN 1 ELSE 0 END) AS enabled_exact_sources
      FROM teams t
      LEFT JOIN sources src
        ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'
       AND src.id=t.id || '-dragonfly-statewide'
      LEFT JOIN team_external_identities tei ON tei.team_id=t.id AND tei.provider='dragonfly'
      WHERE t.active=1 AND t.sport=? AND t.gender=? AND t.season=?
    `).bind(config.sport,config.gender,config.season).all();
    addMeta(meta,counts);
    const row=state.results?.[0]||{};
    const count=counts.results?.[0]||{};
    sports.push({
      key:config.key,teamCode:config.teamCode,expectedTargets:config.expectedTargets,minEvents:config.minEvents,
      catalogSuccessAt:row.catalog_success_at||null,catalogError:row.catalog_error||null,
      catalogMappedSchools:Number(row.mapped_schools||0),catalogStatewideSources:Number(row.statewide_sources||0),
      collectionSuccessAt:row.collection_success_at||null,collectionError:row.collection_error||null,
      lastEventCount:Number(row.last_event_count||0),lastObservationCount:Number(row.last_observation_count||0),lastSourceCount:Number(row.last_source_count||0),
      exactSourceRows:Number(count.exact_source_rows||0),identityTeams:Number(count.identity_teams||0),
      enabledExactSources:Number(count.enabled_exact_sources||0)
    });
  }
  const global=await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name IN (
        'idx_canonical_members_reporting_team','idx_games_team_record_lookup','idx_games_source_time','idx_games_opponent_time','idx_sources_enabled_checked'
      )) AS protection_index_count,
      (SELECT COUNT(*) FROM sources WHERE collection_mode='statewide' AND enabled=1) AS enabled_statewide_sources
  `).all();
  addMeta(meta,global);
  const first=global.results?.[0]||{};
  const globalState={
    protectionIndexCount:Number(first.protection_index_count||0),
    enabledStatewideSources:Number(first.enabled_statewide_sources||0)
  };
  const complete=sports.length===6 && sports.every(item=>
    item.catalogError===null && item.collectionError===null
    && Boolean(item.catalogSuccessAt) && Boolean(item.collectionSuccessAt)
    && item.catalogMappedSchools===item.expectedTargets
    && item.catalogStatewideSources===item.expectedTargets
    && item.exactSourceRows===item.expectedTargets
    && item.identityTeams===item.expectedTargets
    && item.enabledExactSources===0
    && item.lastSourceCount===item.expectedTargets
    && item.lastEventCount>=item.minEvents
    && item.lastObservationCount>0
  ) && globalState.protectionIndexCount===5 && globalState.enabledStatewideSources===0;
  return {
    complete,sports,
    totals:{
      expectedTargets:sports.reduce((n,item)=>n+item.expectedTargets,0),
      exactSourceRows:sports.reduce((n,item)=>n+item.exactSourceRows,0),
      identityTeams:sports.reduce((n,item)=>n+item.identityTeams,0),
      observations:sports.reduce((n,item)=>n+item.lastObservationCount,0),
      enabledExactSources:sports.reduce((n,item)=>n+item.enabledExactSources,0)
    },
    global:globalState,
    expectedProtectionIndexes:PROTECTION_INDEXES,
    d1Meta:meta
  };
}

export async function maybeHandleM2ProductionBootstrapV3(request,env){
  const url=new URL(request.url);
  if (request.method!=="GET") return null;
  if (url.pathname===M2_BOOTSTRAP_V3_READY_PATH) {
    return json({ready:true,release:"m2-production-bootstrap-sport-scoped-v3-20260903"});
  }
  if (request.headers.get(HEADER)!==HEADER_VALUE) {
    if (url.pathname.startsWith(PREFLIGHT_PREFIX) || url.pathname.startsWith(RUN_PREFIX) || url.pathname===M2_BOOTSTRAP_V3_VERIFY_PATH) {
      return json({error:"not_found"},404);
    }
    return null;
  }
  const preflightConfig=configFromPath(url.pathname,PREFLIGHT_PREFIX);
  if (preflightConfig) {
    try {
      const result=await sportPreflight(env,preflightConfig);
      return json({status:result.summary.safe?"SUCCESS":"PREFLIGHT_FAILED",...result.summary},result.summary.safe?200:409);
    } catch (error) {
      return json({status:"FAILURE",stage:"sport-preflight",error:String(error?.message||error)},409);
    }
  }
  const runConfig=configFromPath(url.pathname,RUN_PREFIX);
  if (runConfig) {
    try {
      const result=await runSport(env,runConfig);
      return json(result,result.status==="SUCCESS"?200:409);
    } catch (error) {
      return json({status:"FAILURE",stage:`sport-run:${runConfig.key}`,error:String(error?.message||error)},409);
    }
  }
  if (url.pathname===M2_BOOTSTRAP_V3_VERIFY_PATH) {
    try {
      const result=await verifyAll(env);
      return json({status:result.complete?"SUCCESS":"VERIFICATION_INCOMPLETE",...result},result.complete?200:409);
    } catch (error) {
      return json({status:"FAILURE",stage:"verification",error:String(error?.message||error)},409);
    }
  }
  return null;
}
