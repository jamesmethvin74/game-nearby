import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { statewideSportConfig, STATEWIDE_HIGH_SCHOOL_SPORTS } from "./statewide-sport-config.js";

const PROVIDER="dragonfly";

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function eventMatches(event,config){
  const sports=Array.isArray(event?.associatedSports)?event.associatedSports:[];
  if (!sports.length) return true;
  return sports.some(item=>{
    const code=clean(item?.code).toUpperCase();
    const level=clean(item?.level).toLowerCase();
    return code===config.providerSportCode && (!level || level.includes("varsity"));
  });
}

export function discoverCertifiedSportParticipants(payload,sportConfig){
  const config=statewideSportConfig(sportConfig);
  const schedule=Array.isArray(payload?.schedule)?payload.schedule:[];
  const entries=new Map();
  for (const event of schedule) {
    if (!eventMatches(event,config)) continue;
    for (const participant of Array.isArray(event?.participants)?event.participants:[]) {
      const externalSchoolId=clean(participant?.orgShortCode).toUpperCase();
      const externalTeamId=clean(participant?.team?.teamId);
      const teamCode=clean(participant?.team?.code);
      const level=clean(participant?.team?.level).toLowerCase();
      if (!externalSchoolId || !externalTeamId || (level && !level.includes("varsity"))) continue;
      const key=`${externalSchoolId}|${externalTeamId}`;
      const current=entries.get(key)||{
        externalSchoolId,
        externalTeamId,
        externalTeamCode:teamCode||null,
        observedName:clean(participant?.name)||externalSchoolId,
        eventCount:0
      };
      current.eventCount++;
      entries.set(key,current);
    }
  }
  return [...entries.values()].sort((a,b)=>a.externalSchoolId.localeCompare(b.externalSchoolId)||a.externalTeamId.localeCompare(b.externalTeamId));
}

async function batchStatements(env,statements,size=50){
  for (let i=0;i<statements.length;i+=size) await env.DB.batch(statements.slice(i,i+size));
}

async function catalogFresh(env,syncId,now,maxAgeHours){
  const row=await env.DB.prepare("SELECT last_successful_sync_at FROM catalog_sync_state WHERE id=?").bind(syncId).first();
  const last=row?.last_successful_sync_at?Date.parse(row.last_successful_sync_at):NaN;
  return Number.isFinite(last) && now.getTime()-last < maxAgeHours*60*60*1000;
}

export async function syncCertifiedDragonFlySportCatalog(env,sportConfig,{
  payload=null,force=false,maxAgeHours=24,fetchFn=fetch,now=new Date()
}={}){
  const config=statewideSportConfig(sportConfig);
  if (!force && !payload && await catalogFresh(env,config.catalogSyncId,now,maxAgeHours)) {
    return {status:"SKIPPED",reason:"catalog_fresh",config,payload:null};
  }
  const checkedAt=now.toISOString();
  try {
    let workingPayload=payload;
    let pagesFetched=null;
    if (!workingPayload) {
      const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{fetchFn,headers:{"user-agent":"LocalBleachersAR-certified-catalog/1.0","accept":"application/json"}});
      workingPayload=fetched.payload;
      pagesFetched=fetched.pageCount;
    }
    const entries=discoverCertifiedSportParticipants(workingPayload,config);
    if (!entries.length) throw new Error(`DragonFly ${config.feedCode} discovery returned no varsity participants`);

    const [{results:identities},{results:teams},{results:existingExternal}]=await Promise.all([
      env.DB.prepare(`
        SELECT sei.external_school_id,sei.school_id
        FROM school_external_identities sei
        JOIN schools s ON s.id=sei.school_id
        WHERE sei.provider=? AND s.catalog_scope='local' AND s.level='high-school' AND s.state='AR'
      `).bind(PROVIDER).all(),
      env.DB.prepare(`
        SELECT t.id,t.school_id
        FROM teams t JOIN schools s ON s.id=t.school_id
        WHERE t.active=1 AND t.sport=? AND t.gender=? AND t.season=?
          AND s.catalog_scope='local' AND s.level='high-school' AND s.state='AR'
      `).bind(config.sport,config.gender,config.season).all(),
      env.DB.prepare("SELECT external_team_id,team_id FROM team_external_identities WHERE provider=?").bind(PROVIDER).all()
    ]);

    const schoolByExternal=new Map(identities.map(row=>[String(row.external_school_id).toUpperCase(),row.school_id]));
    const teamBySchool=new Map(teams.map(row=>[row.school_id,row.id]));
    const existingTeamByExternal=new Map(existingExternal.map(row=>[String(row.external_team_id),row.team_id]));
    const statements=[];
    const mapped=[];
    const quarantined=[];

    for (const entry of entries) {
      const schoolId=schoolByExternal.get(entry.externalSchoolId);
      if (!schoolId) {
        quarantined.push({...entry,reason:"uncertified_or_unmapped_school"});
        continue;
      }
      const teamId=teamBySchool.get(schoolId);
      if (!teamId) {
        quarantined.push({...entry,schoolId,reason:"sport_not_certified_for_school"});
        continue;
      }
      const existingTeamId=existingTeamByExternal.get(entry.externalTeamId);
      if (existingTeamId && existingTeamId!==teamId) {
        quarantined.push({...entry,schoolId,teamId,existingTeamId,reason:"external_team_identity_collision"});
        continue;
      }

      const sourceId=`${teamId}-dragonfly-statewide`;
      mapped.push({...entry,schoolId,teamId,sourceId});
      statements.push(env.DB.prepare(`
        INSERT INTO team_external_identities(provider,external_team_id,team_id,external_code,last_seen_at,updated_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(provider,external_team_id) DO UPDATE SET
          team_id=excluded.team_id,external_code=excluded.external_code,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
      `).bind(PROVIDER,entry.externalTeamId,teamId,entry.externalTeamCode||config.providerSportCode,checkedAt,checkedAt));
      statements.push(env.DB.prepare(`
        INSERT INTO sources
          (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
        VALUES(?,?,?,'official-conference',1,'dragonfly-public','5','America/Chicago',?,180,30,0,10,720,'statewide',?)
        ON CONFLICT(id) DO UPDATE SET
          team_id=excluded.team_id,source_url=excluded.source_url,parser_version=excluded.parser_version,
          expected_min_games=excluded.expected_min_games,enabled=0,authority_rank=10,stale_after_minutes=720,collection_mode='statewide',updated_at=excluded.updated_at
      `).bind(sourceId,teamId,config.feedUrl,Math.max(1,Math.min(5,entry.eventCount)),checkedAt));
    }

    if (!mapped.length) throw new Error(`DragonFly ${config.feedCode} produced zero certified team mappings`);
    await batchStatements(env,statements);

    const details={
      feedCode:config.feedCode,
      providerSportCode:config.providerSportCode,
      pagesFetched,
      rawEvents:Array.isArray(workingPayload?.schedule)?workingPayload.schedule.length:0,
      discoveredParticipants:entries.length,
      mappedParticipants:mapped.length,
      mappedSchools:new Set(mapped.map(item=>item.schoolId)).size,
      expectedTargets:config.expectedTargets,
      quarantinedCount:quarantined.length,
      quarantined:quarantined.slice(0,100)
    };
    await env.DB.prepare(`
      INSERT INTO catalog_sync_state
        (id,provider,feed_url,last_checked_at,last_successful_sync_at,discovered_school_count,discovered_team_count,active_source_count,ambiguous_name_count,last_error,details_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET
        feed_url=excluded.feed_url,last_checked_at=excluded.last_checked_at,last_successful_sync_at=excluded.last_successful_sync_at,
        discovered_school_count=excluded.discovered_school_count,discovered_team_count=excluded.discovered_team_count,
        active_source_count=excluded.active_source_count,ambiguous_name_count=excluded.ambiguous_name_count,
        last_error=NULL,details_json=excluded.details_json,updated_at=excluded.updated_at
    `).bind(config.catalogSyncId,PROVIDER,config.feedUrl,checkedAt,checkedAt,details.mappedSchools,mapped.length,0,quarantined.length,JSON.stringify(details),checkedAt).run();

    return {status:"SUCCESS",config,pagesFetched,mapped:mapped.length,mappedSchools:details.mappedSchools,quarantined:quarantined.length,payload:workingPayload};
  } catch (error) {
    const message=String(error?.message||error).slice(0,1000);
    await env.DB.prepare(`
      INSERT INTO catalog_sync_state(id,provider,feed_url,last_checked_at,last_error,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,last_error=excluded.last_error,updated_at=excluded.updated_at
    `).bind(config.catalogSyncId,PROVIDER,config.feedUrl,checkedAt,message,checkedAt).run();
    throw error;
  }
}

export async function syncAllCertifiedDragonFlySportCatalogs(env,options={}){
  const payloads=new Map();
  const results=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    const result=await syncCertifiedDragonFlySportCatalog(env,config,options);
    results.push({...result,payload:undefined});
    if (result.payload) payloads.set(config.key,result.payload);
  }
  return {results,payloads};
}
