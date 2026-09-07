import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { fetchPublishedStandings, listPublishedStandingsOptions } from "./published-standings.js";

const SPORT="volleyball";
const GENDER="girls";
const SEASON="2026";
const FETCH_BATCH_SIZE=5;

function localConferenceId(publishedId) {
  return `${String(publishedId||"").trim().toLowerCase()}-volleyball`;
}

function uniqueLocalTeamMap(localTeams=[]) {
  const byName=new Map();
  for(const team of localTeams) {
    for(const rawName of [team.school_name,team.location_matched_name]) {
      const key=normalizeSchoolAlias(rawName);
      if(!key) continue;
      if(!byName.has(key)) byName.set(key,new Map());
      byName.get(key).set(team.team_id,team);
    }
  }
  return new Map([...byName].map(([key,teams])=>[key,[...teams.values()]]));
}

export function buildVolleyballConferenceMembership({conferences=[],standingsByConference=new Map(),localTeams=[]}={}) {
  const byName=uniqueLocalTeamMap(localTeams);
  const candidates=new Map();
  const conferenceRows=[];
  const unmatched=[];
  const ambiguous=[];

  for(const conference of conferences) {
    const standings=standingsByConference.get(conference.id)?.standings||[];
    const conferenceId=localConferenceId(conference.id);
    let matchedHere=0;
    for(const row of standings) {
      const key=normalizeSchoolAlias(row.school_name);
      const matches=key?(byName.get(key)||[]):[];
      if(matches.length===0) {
        unmatched.push({conference_id:conferenceId,school_name:row.school_name});
        continue;
      }
      if(matches.length!==1) {
        ambiguous.push({conference_id:conferenceId,school_name:row.school_name,candidates:matches.map(team=>team.team_id)});
        continue;
      }
      const team=matches[0];
      if(!candidates.has(team.team_id)) candidates.set(team.team_id,[]);
      candidates.get(team.team_id).push({team_id:team.team_id,school_id:team.school_id,conference_id:conferenceId,conference_name:conference.name});
      matchedHere++;
    }
    if(matchedHere>0) conferenceRows.push({id:conferenceId,name:conference.name,source_url:conference.source_url||null});
  }

  const assignments=[];
  for(const [teamId,rows] of candidates) {
    const ids=[...new Set(rows.map(row=>row.conference_id))];
    if(ids.length!==1) {
      ambiguous.push({team_id:teamId,conference_ids:ids,reason:"multiple_published_conferences"});
      continue;
    }
    assignments.push(rows[0]);
  }

  const allowed=new Set(assignments.map(row=>row.conference_id));
  return {
    conferences:conferenceRows.filter((row,index,all)=>allowed.has(row.id)&&all.findIndex(other=>other.id===row.id)===index),
    assignments,
    unmatched,
    ambiguous
  };
}

function scopeBuiltMembership(built,targetTeamIds=null) {
  const targetSet=targetTeamIds?.length?new Set(targetTeamIds.map(String)):null;
  if(!targetSet) return built;
  const assignments=built.assignments.filter(row=>targetSet.has(String(row.team_id)));
  const conferenceIds=new Set(assignments.map(row=>row.conference_id));
  return {
    ...built,
    assignments,
    conferences:built.conferences.filter(row=>conferenceIds.has(row.id))
  };
}

function cachedFetch(fetchFn) {
  const cache=new Map();
  return async (url,init)=>{
    const key=String(url);
    if(!cache.has(key)) cache.set(key,Promise.resolve(fetchFn(url,init)));
    const response=await cache.get(key);
    return response.clone();
  };
}

async function fetchPublishedVolleyballConferences(fetchFn,{conferenceIds=null}={}) {
  const memoFetch=cachedFetch(fetchFn);
  const options=await listPublishedStandingsOptions({sport:SPORT,fetchFn:memoFetch});
  const wanted=conferenceIds?.length?new Set(conferenceIds.map(value=>String(value||"").trim().toLowerCase()).filter(Boolean)):null;
  const conferences=wanted?options.conferences.filter(row=>wanted.has(String(row.id).toLowerCase())):options.conferences;
  const standingsByConference=new Map();
  const failures=[];
  for(let i=0;i<conferences.length;i+=FETCH_BATCH_SIZE) {
    const batch=conferences.slice(i,i+FETCH_BATCH_SIZE);
    const results=await Promise.all(batch.map(async conference=>{
      try {
        const standings=await fetchPublishedStandings({sport:SPORT,conferenceId:conference.id,fetchFn:memoFetch});
        return {conference,standings};
      } catch(error) {
        return {conference,error:String(error?.message||error)};
      }
    }));
    for(const result of results) {
      if(result.standings) standingsByConference.set(result.conference.id,result.standings);
      else failures.push({conference_id:result.conference.id,error:result.error});
    }
  }
  return {discoveredConferences:options.conferences.length,conferences,standingsByConference,failures};
}

async function loadLocalVolleyballTeams(env) {
  const result=await env.DB.prepare(`
    SELECT t.id AS team_id,t.school_id,t.conference_id,
      s.name AS school_name,s.location_matched_name
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport=? AND t.gender=? AND t.season=?
      AND s.level='high-school' AND s.catalog_scope='local'
  `).bind(SPORT,GENDER,SEASON).all();
  return result.results||[];
}

function conferenceUpsertStatement(env,conferences,now) {
  return env.DB.prepare(`
    WITH payload AS (
      SELECT
        json_extract(value,'$.id') AS id,
        json_extract(value,'$.name') AS name,
        json_extract(value,'$.source_url') AS source_url
      FROM json_each(?)
    )
    INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,source_url,updated_at)
    SELECT id,name,'Arkansas high school volleyball','published',0,source_url,?
    FROM payload WHERE true
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      classification=excluded.classification,
      standings_method=excluded.standings_method,
      coverage_complete=0,
      source_url=COALESCE(excluded.source_url,conferences.source_url),
      updated_at=excluded.updated_at
    WHERE conferences.name<>excluded.name
       OR COALESCE(conferences.classification,'')<>COALESCE(excluded.classification,'')
       OR conferences.standings_method<>excluded.standings_method
       OR conferences.coverage_complete<>excluded.coverage_complete
       OR COALESCE(conferences.source_url,'')<>COALESCE(excluded.source_url,'')
  `).bind(JSON.stringify(conferences),now);
}

function teamMembershipUpdateStatement(env,assignments,now) {
  return env.DB.prepare(`
    WITH payload AS (
      SELECT
        json_extract(value,'$.team_id') AS team_id,
        json_extract(value,'$.conference_id') AS conference_id
      FROM json_each(?)
    )
    UPDATE teams
    SET conference_id=(SELECT p.conference_id FROM payload p WHERE p.team_id=teams.id),
        updated_at=?
    WHERE id IN (SELECT team_id FROM payload)
      AND COALESCE(conference_id,'')<>COALESCE((SELECT p.conference_id FROM payload p WHERE p.team_id=teams.id),'')
  `).bind(JSON.stringify(assignments),now);
}

export async function syncPublishedVolleyballConferenceMembership(env,{
  fetchFn=fetch,
  now=new Date(),
  conferenceIds=null,
  targetTeamIds=null
}={}) {
  const checkedAt=now.toISOString();
  const localTeams=await loadLocalVolleyballTeams(env);
  const published=await fetchPublishedVolleyballConferences(fetchFn,{conferenceIds});
  const built=scopeBuiltMembership(buildVolleyballConferenceMembership({
    conferences:published.conferences,
    standingsByConference:published.standingsByConference,
    localTeams
  }),targetTeamIds);

  if(!built.assignments.length) {
    return {
      status:"NO_MATCHES",
      discoveredConferences:published.discoveredConferences,
      selectedConferences:published.conferences.length,
      fetchedConferences:published.standingsByConference.size,
      failedConferences:published.failures,
      assignments:0,
      unmatched:built.unmatched.length,
      ambiguous:built.ambiguous
    };
  }

  // Keep production D1 work set-based: exactly two mutation statements regardless
  // of how many schools are mapped (conference upsert + changed team memberships).
  const results=await env.DB.batch([
    conferenceUpsertStatement(env,built.conferences,checkedAt),
    teamMembershipUpdateStatement(env,built.assignments,checkedAt)
  ]);
  return {
    status:"SUCCESS",
    discoveredConferences:published.discoveredConferences,
    selectedConferences:published.conferences.length,
    fetchedConferences:published.standingsByConference.size,
    failedConferences:published.failures,
    conferenceRows:built.conferences.length,
    assignments:built.assignments.length,
    unmatched:built.unmatched.length,
    ambiguous:built.ambiguous,
    d1Statements:2,
    conferenceWrites:Number(results?.[0]?.meta?.changes||results?.[0]?.changes||0),
    teamWrites:Number(results?.[1]?.meta?.changes||results?.[1]?.changes||0)
  };
}

export { FETCH_BATCH_SIZE, localConferenceId };
