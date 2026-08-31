import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { normalizeSchoolAlias } from "./schedule-authority-core.js";

const PROVIDER="dragonfly";
const DEFAULT_FEED="https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0";
const DEFAULT_SYNC_ID="dragonfly:ArkAA:2026:WVB_Varsity";

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function safe(value){return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function placeholderSchoolName(value){
  const key=normalizeSchoolAlias(value);
  return !key || /^(?:tbd|tba|open|unknown|to be determined|to be announced)$/.test(key);
}

function isVarsityVolleyballEvent(event){
  const sports=Array.isArray(event?.associatedSports)?event.associatedSports:[];
  if (!sports.length) return true;
  return sports.some(s=>{
    const code=clean(s?.code).toUpperCase();
    const name=clean(s?.name).toLowerCase();
    const level=clean(s?.level).toLowerCase();
    return (code==="WVB" || name.includes("volleyball")) && (!level || level.includes("varsity"));
  });
}

export function discoverDragonFlyVarsityVolleyballTeams(payload){
  const schedule=Array.isArray(payload?.schedule)?payload.schedule:[];
  const byTeam=new Map();
  for (const event of schedule) {
    if (!isVarsityVolleyballEvent(event)) continue;
    for (const participant of Array.isArray(event?.participants)?event.participants:[]) {
      const schoolName=clean(participant?.name);
      const orgShortCode=clean(participant?.orgShortCode).toUpperCase();
      const teamId=clean(participant?.team?.teamId);
      const teamCode=clean(participant?.team?.code);
      const level=clean(participant?.team?.level).toLowerCase();
      if (!schoolName || placeholderSchoolName(schoolName) || !orgShortCode || !teamId || (level && !level.includes("varsity"))) continue;
      const key=`${orgShortCode}|${teamId}`;
      const current=byTeam.get(key) || {
        schoolName,orgShortCode,teamId,teamCode,participantUri:clean(participant?.uri),eventCount:0,
        normalizedSchoolName:normalizeSchoolAlias(schoolName)
      };
      current.eventCount++;
      byTeam.set(key,current);
    }
  }
  return [...byTeam.values()].sort((a,b)=>a.schoolName.localeCompare(b.schoolName)||a.teamId.localeCompare(b.teamId));
}

export function catalogAmbiguities(entries){
  const schools=new Map();
  for (const entry of entries) {
    const key=entry.normalizedSchoolName || normalizeSchoolAlias(entry.schoolName);
    if (!key) continue;
    const codes=schools.get(key)||new Set();
    codes.add(entry.orgShortCode);
    schools.set(key,codes);
  }
  return new Set([...schools.entries()].filter(([,codes])=>codes.size>1).map(([key])=>key));
}

async function batchStatements(env,statements,size=50){
  for (let i=0;i<statements.length;i+=size) await env.DB.batch(statements.slice(i,i+size));
}

async function catalogFresh(env,syncId,now,maxAgeHours){
  const row=await env.DB.prepare("SELECT last_successful_sync_at FROM catalog_sync_state WHERE id=?").bind(syncId).first();
  const last=row?.last_successful_sync_at?Date.parse(row.last_successful_sync_at):NaN;
  return Number.isFinite(last) && now.getTime()-last < maxAgeHours*60*60*1000;
}

export async function syncDragonFlyVarsityVolleyballCatalog(env,{
  feedUrl=DEFAULT_FEED,syncId=DEFAULT_SYNC_ID,season="2026",force=false,maxAgeHours=24,fetchFn=fetch,now=new Date()
}={}){
  if (!force && await catalogFresh(env,syncId,now,maxAgeHours)) return {status:"SKIPPED",reason:"catalog_fresh"};
  const checkedAt=now.toISOString();
  try {
    const {payload,pageCount}=await fetchDragonFlyPagedPayload(feedUrl,{fetchFn,headers:{"user-agent":"LocalBleachersAR-catalog/1.0","accept":"application/json"}});
    const entries=discoverDragonFlyVarsityVolleyballTeams(payload);
    if (entries.length<10) throw new Error(`DragonFly catalog discovery returned only ${entries.length} varsity volleyball teams`);
    const ambiguous=catalogAmbiguities(entries);

    const [{results:schools},{results:aliases},{results:schoolExternal},{results:teams},{results:teamExternal}]=await Promise.all([
      env.DB.prepare("SELECT id,name,mascot,latitude,longitude FROM schools").all(),
      env.DB.prepare("SELECT normalized_alias,school_id FROM school_aliases").all(),
      env.DB.prepare("SELECT external_school_id,school_id FROM school_external_identities WHERE provider=?").bind(PROVIDER).all(),
      env.DB.prepare("SELECT id,school_id FROM teams WHERE sport='volleyball' AND gender='girls' AND season=?").bind(season).all(),
      env.DB.prepare("SELECT external_team_id,team_id FROM team_external_identities WHERE provider=?").bind(PROVIDER).all()
    ]);

    const schoolByExternal=new Map(schoolExternal.map(r=>[String(r.external_school_id).toUpperCase(),r.school_id]));
    const teamByExternal=new Map(teamExternal.map(r=>[String(r.external_team_id),r.team_id]));
    const aliasMap=new Map(aliases.map(r=>[r.normalized_alias,r.school_id]));
    const schoolByName=new Map();
    for (const school of schools) {
      for (const key of [normalizeSchoolAlias(school.name),normalizeSchoolAlias(`${school.name} ${school.mascot||""}`)]) {
        if (key && !schoolByName.has(key)) schoolByName.set(key,school.id);
      }
    }
    const teamBySchool=new Map(teams.map(r=>[r.school_id,r.id]));
    const schoolMeta=new Map(schools.map(r=>[r.id,r]));
    const statements=[];
    const plannedSchoolIds=new Map();
    const plannedTeamIds=new Map();
    let createdSchools=0,createdTeams=0,activeSources=0;

    for (const entry of entries) {
      const nameKey=entry.normalizedSchoolName;
      let schoolId=schoolByExternal.get(entry.orgShortCode) || plannedSchoolIds.get(entry.orgShortCode);
      if (!schoolId) schoolId=aliasMap.get(nameKey) || schoolByName.get(nameKey) || null;
      if (!schoolId) {
        schoolId=`df-${safe(entry.orgShortCode)}`;
        createdSchools++;
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO schools(id,name,city,state,level,updated_at) VALUES(?,?,'','AR','high-school',?)`).bind(schoolId,entry.schoolName,checkedAt));
        schoolMeta.set(schoolId,{id:schoolId,name:entry.schoolName,mascot:null,latitude:null,longitude:null});
      }
      plannedSchoolIds.set(entry.orgShortCode,schoolId);
      schoolByExternal.set(entry.orgShortCode,schoolId);
      statements.push(env.DB.prepare(`INSERT INTO school_external_identities(provider,external_school_id,school_id,observed_name,last_seen_at,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(provider,external_school_id) DO UPDATE SET school_id=excluded.school_id,observed_name=excluded.observed_name,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
        .bind(PROVIDER,entry.orgShortCode,schoolId,entry.schoolName,checkedAt,checkedAt));
      if (nameKey && !ambiguous.has(nameKey) && (!aliasMap.has(nameKey) || aliasMap.get(nameKey)===schoolId)) {
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO school_aliases(normalized_alias,school_id,alias_text) VALUES(?,?,?)").bind(nameKey,schoolId,entry.schoolName));
        aliasMap.set(nameKey,schoolId);
      }

      let teamId=teamByExternal.get(entry.teamId) || plannedTeamIds.get(entry.teamId) || teamBySchool.get(schoolId) || null;
      if (!teamId) {
        teamId=`${schoolId}-volleyball-${season}`;
        createdTeams++;
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
          VALUES(?,?,'volleyball','girls',?,NULL,1,?)`).bind(teamId,schoolId,season,checkedAt));
        teamBySchool.set(schoolId,teamId);
      }
      plannedTeamIds.set(entry.teamId,teamId);
      teamByExternal.set(entry.teamId,teamId);
      statements.push(env.DB.prepare(`INSERT INTO team_external_identities(provider,external_team_id,team_id,external_code,last_seen_at,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(provider,external_team_id) DO UPDATE SET team_id=excluded.team_id,external_code=excluded.external_code,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
        .bind(PROVIDER,entry.teamId,teamId,entry.teamCode||null,checkedAt,checkedAt));

      if (!ambiguous.has(nameKey)) {
        const meta=schoolMeta.get(schoolId)||{};
        const sourceId=`${teamId}-dragonfly`;
        const expected=Math.max(1,Math.min(5,Number(entry.eventCount)||1));
        statements.push(env.DB.prepare(`INSERT INTO sources
          (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,authority_rank,stale_after_minutes,updated_at)
          VALUES(?,?,?,'official-conference',1,'dragonfly-public','4','America/Chicago',?,180,60,?,?,?,1,10,720,?)
          ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,parser_version=excluded.parser_version,expected_min_games=excluded.expected_min_games,
            home_venue=excluded.home_venue,home_latitude=COALESCE(sources.home_latitude,excluded.home_latitude),home_longitude=COALESCE(sources.home_longitude,excluded.home_longitude),
            enabled=1,authority_rank=10,stale_after_minutes=720,updated_at=excluded.updated_at`)
          .bind(sourceId,teamId,feedUrl,expected,entry.schoolName,meta.latitude??null,meta.longitude??null,checkedAt));
        activeSources++;
      }
    }

    await batchStatements(env,statements);
    const details={pages:pageCount,statewideEvents:Array.isArray(payload?.schedule)?payload.schedule.length:0,createdSchools,createdTeams,ambiguousNames:[...ambiguous].sort()};
    await env.DB.prepare(`INSERT INTO catalog_sync_state
      (id,provider,feed_url,last_checked_at,last_successful_sync_at,discovered_school_count,discovered_team_count,active_source_count,ambiguous_name_count,last_error,details_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET feed_url=excluded.feed_url,last_checked_at=excluded.last_checked_at,last_successful_sync_at=excluded.last_successful_sync_at,
        discovered_school_count=excluded.discovered_school_count,discovered_team_count=excluded.discovered_team_count,active_source_count=excluded.active_source_count,
        ambiguous_name_count=excluded.ambiguous_name_count,last_error=NULL,details_json=excluded.details_json,updated_at=excluded.updated_at`)
      .bind(syncId,PROVIDER,feedUrl,checkedAt,checkedAt,new Set(entries.map(e=>e.orgShortCode)).size,entries.length,activeSources,ambiguous.size,JSON.stringify(details),checkedAt).run();
    return {status:"SUCCESS",entries:entries.length,schools:new Set(entries.map(e=>e.orgShortCode)).size,activeSources,ambiguousNames:ambiguous.size,pagesFetched:pageCount,...details};
  } catch (error) {
    const message=String(error?.message||error).slice(0,1000);
    await env.DB.prepare(`INSERT INTO catalog_sync_state(id,provider,feed_url,last_checked_at,last_error,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .bind(syncId,PROVIDER,feedUrl,checkedAt,message,checkedAt).run();
    throw error;
  }
}
