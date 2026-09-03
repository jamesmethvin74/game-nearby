import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import {
  certifiedTargetSchoolIds,
  discoverCertifiedSportParticipants,
  syncCertifiedDragonFlySportCatalog
} from "./dragonfly-certified-sport-catalog.js";
import { runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { readM2BootstrapStatus } from "./m2-bootstrap-status.js";
import { STATEWIDE_HIGH_SCHOOL_SPORTS } from "./statewide-sport-config.js";

const PROTECTION_INDEXES=[
  "idx_canonical_members_reporting_team",
  "idx_games_team_record_lookup",
  "idx_games_source_time",
  "idx_games_opponent_time",
  "idx_sources_enabled_checked"
];

function expectedTotal(){
  return STATEWIDE_HIGH_SCHOOL_SPORTS.reduce((sum,config)=>sum+config.expectedTargets,0);
}

async function fetchAndValidateAllFeeds(){
  const payloads=new Map();
  const providerFetch=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{
      headers:{"user-agent":"LocalBleachersAR-M2-production-bootstrap/3.0","accept":"application/json"}
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

async function preflightSport(env,config,payload){
  const certified=[...certifiedTargetSchoolIds(config)];
  const entries=discoverCertifiedSportParticipants(payload,config).filter(entry=>certified.includes(entry.externalSchoolId));
  const externalTeamIds=[...new Set(entries.map(entry=>entry.externalTeamId))];

  const resolved=await env.DB.prepare(`
    SELECT sei.external_school_id,t.id AS team_id
    FROM school_external_identities sei
    JOIN teams t ON t.school_id=sei.school_id
      AND t.active=1 AND t.sport=? AND t.gender=? AND t.season=?
    WHERE sei.provider='dragonfly'
      AND sei.external_school_id IN (SELECT value FROM json_each(?))
  `).bind(config.sport,config.gender,config.season,JSON.stringify(certified)).all();

  const resolvedRows=resolved.results||[];
  const teamBySchool=new Map(resolvedRows.map(row=>[String(row.external_school_id),String(row.team_id)]));
  const existing=externalTeamIds.length ? await env.DB.prepare(`
    SELECT external_team_id,team_id
    FROM team_external_identities
    WHERE provider='dragonfly'
      AND external_team_id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(externalTeamIds)).all() : {results:[],meta:{}};

  let collisions=0;
  for (const row of existing.results||[]) {
    const entry=entries.find(item=>item.externalTeamId===String(row.external_team_id));
    const expectedTeamId=entry?teamBySchool.get(entry.externalSchoolId):null;
    if (expectedTeamId && String(row.team_id)!==expectedTeamId) collisions++;
  }

  const rowsRead=Number(resolved.meta?.rows_read||0)+Number(existing.meta?.rows_read||0);
  const rowsWritten=Number(resolved.meta?.rows_written||0)+Number(existing.meta?.rows_written||0);
  const durationMs=(Number(resolved.meta?.duration||0)||0)+(Number(existing.meta?.duration||0)||0);
  return {
    key:config.key,
    expectedTargets:config.expectedTargets,
    resolvedTargets:teamBySchool.size,
    plannedExternalTeams:externalTeamIds.length,
    externalTeamIdentityCollisions:collisions,
    safe:teamBySchool.size===config.expectedTargets && collisions===0,
    d1Meta:{rowsRead,rowsWritten,durationMs}
  };
}

async function preflightProductionMappings(env,payloads){
  const sports=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    sports.push(await preflightSport(env,config,payloads.get(config.key)));
  }
  const summary={
    expectedTargets:expectedTotal(),
    resolvedTargets:sports.reduce((n,item)=>n+item.resolvedTargets,0),
    externalTeamIdentityCollisions:sports.reduce((n,item)=>n+item.externalTeamIdentityCollisions,0),
    sports,
    d1Meta:{
      rowsRead:sports.reduce((n,item)=>n+item.d1Meta.rowsRead,0),
      rowsWritten:sports.reduce((n,item)=>n+item.d1Meta.rowsWritten,0),
      durationMs:sports.reduce((n,item)=>n+item.d1Meta.durationMs,0)
    }
  };
  summary.safe=summary.expectedTargets===1102
    && summary.resolvedTargets===1102
    && summary.externalTeamIdentityCollisions===0
    && sports.every(item=>item.safe);
  return summary;
}

async function verifyProductionBootstrap(env,startedAt){
  const status=await readM2BootstrapStatus(env);
  const globalResult=await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name IN (
        'idx_canonical_members_reporting_team','idx_games_team_record_lookup','idx_games_source_time','idx_games_opponent_time','idx_sources_enabled_checked'
      )) AS protection_index_count,
      (SELECT COUNT(*) FROM sources WHERE collection_mode='statewide' AND enabled=1) AS enabled_statewide_sources
  `).all();
  const globalRow=globalResult.results?.[0]||{};
  const startedMs=Date.parse(startedAt);
  const configByKey=new Map(STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>[config.key,config]));
  const complete=status.sports.length===6 && status.sports.every(item=>{
    const config=configByKey.get(item.key);
    const catalogMs=Date.parse(item.catalogSuccessAt||"");
    const collectionMs=Date.parse(item.collectionSuccessAt||"");
    return Boolean(config)
      && item.catalogError===null
      && item.collectionError===null
      && Number.isFinite(catalogMs) && catalogMs>=startedMs
      && Number.isFinite(collectionMs) && collectionMs>=startedMs
      && item.catalogMappedSchools===item.expectedTargets
      && item.catalogStatewideSources===item.expectedTargets
      && item.exactSourceRows===item.expectedTargets
      && item.enabledExactSources===0
      && item.lastSourceCount===item.expectedTargets
      && item.lastEventCount>=config.minEvents
      && item.lastObservationCount>0;
  }) && Number(globalRow.protection_index_count||0)===5
    && Number(globalRow.enabled_statewide_sources||0)===0;

  return {
    complete,
    sports:status.sports,
    totals:status.totals,
    global:{
      protectionIndexCount:Number(globalRow.protection_index_count||0),
      enabledStatewideSources:Number(globalRow.enabled_statewide_sources||0)
    },
    expectedProtectionIndexes:PROTECTION_INDEXES,
    d1Meta:{
      rowsRead:Number(status.d1Meta?.rowsRead||0)+Number(globalResult.meta?.rows_read||0),
      rowsWritten:Number(status.d1Meta?.rowsWritten||0)+Number(globalResult.meta?.rows_written||0),
      durationMs:Number(status.d1Meta?.durationMs||0)+(Number(globalResult.meta?.duration||0)||0)
    }
  };
}

export async function runM2ProductionBootstrapV3(env){
  const startedAt=new Date().toISOString();
  const output={startedAt,providerFetch:[],preflight:null,catalogs:[],collections:[],verification:null};
  let stage="provider-prefetch";
  try {
    const fetched=await fetchAndValidateAllFeeds();
    const payloads=fetched.payloads;
    output.providerFetch=fetched.providerFetch;

    stage="d1-preflight-v3";
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
      stage,...output,completedAt:new Date().toISOString()
    };
  } catch (error) {
    return {
      status:"FAILURE",stage,...output,error:String(error?.message||error),failedAt:new Date().toISOString()
    };
  }
}
