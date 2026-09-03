import inventory from "../data/arkansas-high-school-team-inventory.json" with { type: "json" };
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
const M2_BOOTSTRAP_HEADER="x-localbleachers-m2-bootstrap";
const M2_BOOTSTRAP_HEADER_VALUE="approved-certified-1102-20260903";
const PROTECTION_INDEXES=[
  "idx_canonical_members_reporting_team",
  "idx_games_team_record_lookup",
  "idx_games_source_time",
  "idx_games_opponent_time",
  "idx_sources_enabled_checked"
];

const EXPECTED_TARGETS=Object.entries(inventory.certified_school_team_codes||{}).flatMap(
  ([external_school_id,codes])=>(codes||[]).map(team_code=>({external_school_id:String(external_school_id).toUpperCase(),team_code}))
);
const EXPECTED_BY_CODE=new Map(STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>[config.teamCode,config.expectedTargets]));
const CATALOG_IDS=STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>config.catalogSyncId);
const STATE_IDS=STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>config.stateId);

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function authorized(request){
  return request.headers.get(M2_BOOTSTRAP_HEADER)===M2_BOOTSTRAP_HEADER_VALUE;
}

function teamMatchSql(alias="t",codeAlias="p.team_code"){
  return `(
    (${codeAlias}='FB'  AND ${alias}.sport='football'   AND ${alias}.gender='boys') OR
    (${codeAlias}='MBB' AND ${alias}.sport='basketball' AND ${alias}.gender='boys') OR
    (${codeAlias}='WBB' AND ${alias}.sport='basketball' AND ${alias}.gender='girls') OR
    (${codeAlias}='MSO' AND ${alias}.sport='soccer'     AND ${alias}.gender='boys') OR
    (${codeAlias}='WSO' AND ${alias}.sport='soccer'     AND ${alias}.gender='girls') OR
    (${codeAlias}='WVB' AND ${alias}.sport='volleyball' AND ${alias}.gender='girls')
  )`;
}

async function preflightProductionMappings(env,payloads){
  const planned=[];
  const provider=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const payload=payloads.get(config.key);
    const certified=certifiedTargetSchoolIds(config);
    const entries=discoverCertifiedSportParticipants(payload,config);
    const targetSchools=new Set();
    for (const entry of entries) {
      if (!certified.has(entry.externalSchoolId)) continue;
      targetSchools.add(entry.externalSchoolId);
      planned.push({
        external_school_id:entry.externalSchoolId,
        team_code:config.teamCode,
        external_team_id:entry.externalTeamId
      });
    }
    provider.push({
      key:config.key,
      feedCode:config.feedCode,
      pages:Number(payload?.pageCount||0)||null,
      events:Array.isArray(payload?.schedule)?payload.schedule.length:0,
      expectedTargets:config.expectedTargets,
      discoveredCertifiedTargets:targetSchools.size
    });
  }

  const result=await env.DB.prepare(`
    WITH planned AS (
      SELECT
        UPPER(json_extract(value,'$.external_school_id')) AS external_school_id,
        json_extract(value,'$.team_code') AS team_code,
        json_extract(value,'$.external_team_id') AS external_team_id
      FROM json_each(?)
    ),
    resolved AS (
      SELECT p.external_school_id,p.team_code,p.external_team_id,t.id AS team_id
      FROM planned p
      JOIN school_external_identities sei
        ON sei.provider='dragonfly' AND UPPER(sei.external_school_id)=p.external_school_id
      JOIN teams t
        ON t.school_id=sei.school_id AND t.active=1 AND t.season='2026'
       AND ${teamMatchSql("t","p.team_code")}
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
    expectedTargets:EXPECTED_TARGETS.length,
    plannedTargets:Number(row.planned_targets||0),
    resolvedTargets:Number(row.resolved_targets||0),
    externalTeamIdentityCollisions:Number(row.external_team_identity_collisions||0),
    provider,
    d1Meta:{
      rowsRead:Number(result.meta?.rows_read||0),
      rowsWritten:Number(result.meta?.rows_written||0),
      durationMs:Number(result.meta?.duration||0)||null
    }
  };
  summary.safe=summary.expectedTargets===1102
    && summary.plannedTargets===1102
    && summary.resolvedTargets===1102
    && summary.externalTeamIdentityCollisions===0
    && provider.every(item=>item.discoveredCertifiedTargets===item.expectedTargets);
  return summary;
}

async function verifyProductionBootstrap(env){
  const result=await env.DB.prepare(`
    WITH expected_targets AS (
      SELECT
        UPPER(json_extract(value,'$.external_school_id')) AS external_school_id,
        json_extract(value,'$.team_code') AS team_code
      FROM json_each(?)
    ),
    expected_counts AS (
      SELECT team_code,COUNT(*) AS expected_targets
      FROM expected_targets GROUP BY team_code
    ),
    certified_teams AS (
      SELECT DISTINCT et.external_school_id,et.team_code,t.id AS team_id
      FROM expected_targets et
      JOIN school_external_identities sei
        ON sei.provider='dragonfly' AND UPPER(sei.external_school_id)=et.external_school_id
      JOIN teams t
        ON t.school_id=sei.school_id AND t.active=1 AND t.season='2026'
       AND ${teamMatchSql("t","et.team_code")}
    ),
    team_counts AS (
      SELECT team_code,COUNT(DISTINCT team_id) AS certified_team_rows
      FROM certified_teams GROUP BY team_code
    ),
    source_stats AS (
      SELECT ct.team_code,
        COUNT(DISTINCT CASE WHEN src.id IS NOT NULL THEN ct.team_id END) AS source_teams,
        COUNT(DISTINCT CASE WHEN src.enabled=1 THEN src.id END) AS enabled_sources
      FROM certified_teams ct
      LEFT JOIN sources src
        ON src.team_id=ct.team_id
       AND src.parser_type='dragonfly-public'
       AND src.collection_mode='statewide'
       AND src.id=ct.team_id || '-dragonfly-statewide'
      GROUP BY ct.team_code
    ),
    identity_stats AS (
      SELECT ct.team_code,COUNT(DISTINCT ct.team_id) AS identity_teams
      FROM certified_teams ct
      JOIN team_external_identities tei
        ON tei.provider='dragonfly' AND tei.team_id=ct.team_id
      GROUP BY ct.team_code
    ),
    game_stats AS (
      SELECT ct.team_code,
        COUNT(DISTINCT g.id) AS observations,
        COUNT(DISTINCT CASE WHEN g.status='FINAL' THEN g.id END) AS final_observations,
        COUNT(DISTINCT CASE WHEN g.id IS NOT NULL THEN ct.team_id END) AS teams_with_games,
        COUNT(DISTINCT g.canonical_event_id) AS canonical_events
      FROM certified_teams ct
      JOIN sources src
        ON src.team_id=ct.team_id
       AND src.parser_type='dragonfly-public'
       AND src.collection_mode='statewide'
       AND src.id=ct.team_id || '-dragonfly-statewide'
      LEFT JOIN games g ON g.source_id=src.id
      GROUP BY ct.team_code
    ),
    record_stats AS (
      SELECT ct.team_code,COUNT(DISTINCT tr.team_id) AS record_teams
      FROM certified_teams ct
      LEFT JOIN team_records tr ON tr.team_id=ct.team_id
      GROUP BY ct.team_code
    ),
    global_stats AS (
      SELECT
        (SELECT COUNT(*) FROM catalog_sync_state
          WHERE id IN (SELECT value FROM json_each(?))
            AND last_successful_sync_at IS NOT NULL AND last_error IS NULL) AS catalog_success_states,
        (SELECT COUNT(*) FROM statewide_collection_state
          WHERE id IN (SELECT value FROM json_each(?))
            AND last_successful_fetch_at IS NOT NULL AND last_error IS NULL) AS collection_success_states,
        (SELECT COUNT(*) FROM sqlite_schema
          WHERE type='index' AND name IN (
            'idx_canonical_members_reporting_team',
            'idx_games_team_record_lookup',
            'idx_games_source_time',
            'idx_games_opponent_time',
            'idx_sources_enabled_checked'
          )) AS protection_index_count,
        (SELECT COUNT(*) FROM sources WHERE collection_mode='statewide' AND enabled=1) AS enabled_statewide_sources
    )
    SELECT
      ec.team_code,ec.expected_targets,
      COALESCE(tc.certified_team_rows,0) AS certified_team_rows,
      COALESCE(ss.source_teams,0) AS source_teams,
      COALESCE(ss.enabled_sources,0) AS enabled_sources,
      COALESCE(its.identity_teams,0) AS identity_teams,
      COALESCE(gs.observations,0) AS observations,
      COALESCE(gs.final_observations,0) AS final_observations,
      COALESCE(gs.teams_with_games,0) AS teams_with_games,
      COALESCE(gs.canonical_events,0) AS canonical_events,
      COALESCE(rs.record_teams,0) AS record_teams,
      gl.catalog_success_states,gl.collection_success_states,
      gl.protection_index_count,gl.enabled_statewide_sources
    FROM expected_counts ec
    LEFT JOIN team_counts tc ON tc.team_code=ec.team_code
    LEFT JOIN source_stats ss ON ss.team_code=ec.team_code
    LEFT JOIN identity_stats its ON its.team_code=ec.team_code
    LEFT JOIN game_stats gs ON gs.team_code=ec.team_code
    LEFT JOIN record_stats rs ON rs.team_code=ec.team_code
    CROSS JOIN global_stats gl
    ORDER BY CASE ec.team_code
      WHEN 'FB' THEN 1 WHEN 'MBB' THEN 2 WHEN 'WBB' THEN 3
      WHEN 'MSO' THEN 4 WHEN 'WSO' THEN 5 WHEN 'WVB' THEN 6 ELSE 99 END
  `).bind(
    JSON.stringify(EXPECTED_TARGETS),
    JSON.stringify(CATALOG_IDS),
    JSON.stringify(STATE_IDS)
  ).all();

  const sports=(result.results||[]).map(row=>({
    teamCode:row.team_code,
    expectedTargets:Number(row.expected_targets||0),
    certifiedTeamRows:Number(row.certified_team_rows||0),
    sourceTeams:Number(row.source_teams||0),
    enabledSources:Number(row.enabled_sources||0),
    identityTeams:Number(row.identity_teams||0),
    observations:Number(row.observations||0),
    finalObservations:Number(row.final_observations||0),
    teamsWithGames:Number(row.teams_with_games||0),
    canonicalEvents:Number(row.canonical_events||0),
    recordTeams:Number(row.record_teams||0)
  }));
  const first=result.results?.[0]||{};
  const global={
    catalogSuccessStates:Number(first.catalog_success_states||0),
    collectionSuccessStates:Number(first.collection_success_states||0),
    protectionIndexCount:Number(first.protection_index_count||0),
    enabledStatewideSources:Number(first.enabled_statewide_sources||0)
  };
  const totals=sports.reduce((acc,item)=>{
    for (const key of ["expectedTargets","certifiedTeamRows","sourceTeams","identityTeams","observations","finalObservations","teamsWithGames","canonicalEvents","recordTeams"]) acc[key]+=item[key];
    return acc;
  },{expectedTargets:0,certifiedTeamRows:0,sourceTeams:0,identityTeams:0,observations:0,finalObservations:0,teamsWithGames:0,canonicalEvents:0,recordTeams:0});

  const structuralComplete=sports.length===6
    && sports.every(item=>{
      const expected=EXPECTED_BY_CODE.get(item.teamCode)||0;
      return item.expectedTargets===expected
        && item.certifiedTeamRows===expected
        && item.sourceTeams===expected
        && item.identityTeams===expected
        && item.enabledSources===0;
    })
    && totals.expectedTargets===1102
    && totals.sourceTeams===1102
    && totals.identityTeams===1102
    && global.catalogSuccessStates===6
    && global.collectionSuccessStates===6
    && global.protectionIndexCount===5
    && global.enabledStatewideSources===0;

  return {
    complete:structuralComplete,
    sports,
    totals,
    global,
    expectedProtectionIndexes:PROTECTION_INDEXES,
    d1Meta:{
      rowsRead:Number(result.meta?.rows_read||0),
      rowsWritten:Number(result.meta?.rows_written||0),
      durationMs:Number(result.meta?.duration||0)||null
    }
  };
}

export async function runM2ProductionBootstrap(env){
  const startedAt=new Date().toISOString();
  const fetchedPayloads=new Map();
  const providerFetch=[];

  // Fetch and validate all six public feeds before making any M2 bootstrap writes.
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{
      headers:{"user-agent":"LocalBleachersAR-M2-production-bootstrap/1.0","accept":"application/json"}
    });
    fetched.payload.pageCount=fetched.pageCount;
    fetchedPayloads.set(config.key,fetched.payload);
    providerFetch.push({
      key:config.key,
      feedCode:config.feedCode,
      pagesFetched:fetched.pageCount,
      events:Array.isArray(fetched.payload?.schedule)?fetched.payload.schedule.length:0
    });
  }

  const preflight=await preflightProductionMappings(env,fetchedPayloads);
  if (!preflight.safe) {
    return {status:"PREFLIGHT_FAILED",startedAt,providerFetch,preflight,verification:null};
  }

  const catalogs=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const result=await syncCertifiedDragonFlySportCatalog(env,config,{
      payload:fetchedPayloads.get(config.key),force:true
    });
    catalogs.push({
      key:config.key,status:result.status,mapped:result.mapped,mappedSchools:result.mappedSchools,
      statewideSources:result.statewideSources,missingCertifiedTargets:result.missingCertifiedTargets,
      quarantined:result.quarantined
    });
  }

  const collections=[];
  try {
    for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
      const result=await runCertifiedDragonFlyStatewideCollection(env,config,{
        payload:fetchedPayloads.get(config.key)
      });
      collections.push({
        key:config.key,status:result.status,events:result.rawEventCount,observations:result.observations,
        canonicalEvents:result.canonicalEvents,sources:result.sources,touchedTeams:result.touchedTeams,
        recordRebuild:result.recordRebuild||null
      });
    }
  } finally {
    await env.DB.prepare("UPDATE sources SET enabled=0 WHERE collection_mode='statewide'").run();
  }

  const verification=await verifyProductionBootstrap(env);
  return {
    status:verification.complete?"SUCCESS":"VERIFICATION_INCOMPLETE",
    startedAt,
    completedAt:new Date().toISOString(),
    providerFetch,
    preflight,
    catalogs,
    collections,
    verification
  };
}

export async function maybeHandleM2ProductionBootstrap(request,env){
  const url=new URL(request.url);
  if (request.method!=="GET") return null;
  if (url.pathname===M2_BOOTSTRAP_READY_PATH) {
    return json({ready:true,release:"m2-production-bootstrap-20260903"});
  }
  if (url.pathname!==M2_BOOTSTRAP_RUN_PATH) return null;
  if (!authorized(request)) return json({error:"not_found"},404);
  try {
    const result=await runM2ProductionBootstrap(env);
    return json(result,result.status==="SUCCESS"?200:409);
  } catch (error) {
    return json({
      status:"FAILURE",
      error:String(error?.message||error),
      failedAt:new Date().toISOString()
    },500);
  }
}
