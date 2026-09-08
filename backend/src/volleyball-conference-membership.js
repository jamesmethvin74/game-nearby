import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { fetchPublishedStandings, listPublishedStandingsOptions, parsePublishedStandings } from "./published-standings.js";

const SPORT="volleyball";
const GENDER="girls";
const SEASON="2026";
const FETCH_BATCH_SIZE=5;
const PUBLISHED_HEADERS={
  "user-agent":"LocalBleachersAR-standings/1.0 (+https://github.com/jamesmethvin74/game-nearby)",
  accept:"text/html,application/xhtml+xml"
};

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

export function planVolleyballConferenceMembershipChanges({assignments=[],localTeams=[]}={}) {
  const currentByTeam=new Map(localTeams.map(team=>[String(team.team_id),team]));
  const aligned=[];
  const missing=[];
  const wrong=[];
  const changes=[];

  for(const assignment of assignments) {
    const team=currentByTeam.get(String(assignment.team_id));
    if(!team) continue;
    const current=String(team.conference_id||"");
    const expected=String(assignment.conference_id||"");
    const row={
      team_id:assignment.team_id,
      school_id:assignment.school_id,
      school_name:team.school_name||null,
      current_conference_id:current||null,
      expected_conference_id:expected||null,
      expected_conference_name:assignment.conference_name||null
    };
    if(current===expected) {
      aligned.push(row);
      continue;
    }
    if(!current) missing.push(row);
    else wrong.push(row);
    changes.push(row);
  }

  return {
    assignments:assignments.length,
    aligned_count:aligned.length,
    missing_count:missing.length,
    wrong_count:wrong.length,
    change_count:changes.length,
    aligned,
    missing,
    wrong,
    changes
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

function normalizeConferenceOverrides(value={}) {
  const map=new Map();
  for(const [rawId,raw] of Object.entries(value||{})) {
    const id=String(rawId||"").trim().toLowerCase();
    if(!id || !raw) continue;
    const source_url=String(raw.source_url||raw.url||"").trim();
    if(!source_url) continue;
    map.set(id,{id,name:String(raw.name||id),sport:SPORT,source_url,direct_source:true});
  }
  return map;
}

async function fetchDirectPublishedStandings(conference,memoFetch) {
  const response=await memoFetch(conference.source_url,{headers:PUBLISHED_HEADERS});
  if(!response.ok) throw new Error(`standings source HTTP ${response.status}`);
  const html=await response.text();
  const parsed=parsePublishedStandings(html,{
    sport:SPORT,
    conferenceId:conference.id,
    conferenceName:conference.name,
    sourceUrl:response.url||conference.source_url
  });
  if(!parsed.standings.length) throw new Error(`published standings unavailable for ${SPORT}/${conference.id}`);
  return parsed;
}

async function fetchPublishedVolleyballConferences(fetchFn,{conferenceIds=null,conferenceSourceOverrides=null}={}) {
  const memoFetch=cachedFetch(fetchFn);
  const wanted=conferenceIds?.length?new Set(conferenceIds.map(value=>String(value||"").trim().toLowerCase()).filter(Boolean)):null;
  const overrides=normalizeConferenceOverrides(conferenceSourceOverrides);

  let discoveredConferences=0;
  let conferences=[];
  if(wanted && [...wanted].every(id=>overrides.has(id))) {
    conferences=[...wanted].map(id=>overrides.get(id));
    discoveredConferences=conferences.length;
  } else {
    const options=await listPublishedStandingsOptions({sport:SPORT,fetchFn:memoFetch});
    discoveredConferences=options.conferences.length;
    conferences=wanted?options.conferences.filter(row=>wanted.has(String(row.id).toLowerCase())):options.conferences;
    conferences=conferences.map(row=>overrides.get(String(row.id).toLowerCase())||row);
  }

  const standingsByConference=new Map();
  const failures=[];
  for(let i=0;i<conferences.length;i+=FETCH_BATCH_SIZE) {
    const batch=conferences.slice(i,i+FETCH_BATCH_SIZE);
    const results=await Promise.all(batch.map(async conference=>{
      try {
        const standings=conference.direct_source
          ? await fetchDirectPublishedStandings(conference,memoFetch)
          : await fetchPublishedStandings({sport:SPORT,conferenceId:conference.id,fetchFn:memoFetch});
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
  return {discoveredConferences,conferences,standingsByConference,failures};
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

function enforceMembershipWriteFuses({plan,conferenceRows,maxTeamChanges,maxConferenceRows}) {
  if(maxTeamChanges!=null) {
    const limit=Number(maxTeamChanges);
    if(!Number.isInteger(limit)||limit<0) throw new Error("maxTeamChanges must be a non-negative integer");
    if(plan.change_count>limit) throw new Error(`volleyball membership team-change fuse exceeded: planned ${plan.change_count}, limit ${limit}`);
  }
  if(maxConferenceRows!=null) {
    const limit=Number(maxConferenceRows);
    if(!Number.isInteger(limit)||limit<0) throw new Error("maxConferenceRows must be a non-negative integer");
    if(conferenceRows>limit) throw new Error(`volleyball membership conference-row fuse exceeded: planned ${conferenceRows}, limit ${limit}`);
  }
}

export async function syncPublishedVolleyballConferenceMembership(env,{
  fetchFn=fetch,
  now=new Date(),
  conferenceIds=null,
  targetTeamIds=null,
  conferenceSourceOverrides=null,
  dryRun=false,
  maxTeamChanges=null,
  maxConferenceRows=null
}={}) {
  const checkedAt=now.toISOString();
  const localTeams=await loadLocalVolleyballTeams(env);
  const published=await fetchPublishedVolleyballConferences(fetchFn,{conferenceIds,conferenceSourceOverrides});
  const built=scopeBuiltMembership(buildVolleyballConferenceMembership({
    conferences:published.conferences,
    standingsByConference:published.standingsByConference,
    localTeams
  }),targetTeamIds);
  const plan=planVolleyballConferenceMembershipChanges({assignments:built.assignments,localTeams});

  enforceMembershipWriteFuses({
    plan,
    conferenceRows:built.conferences.length,
    maxTeamChanges,
    maxConferenceRows
  });

  const base={
    discoveredConferences:published.discoveredConferences,
    selectedConferences:published.conferences.length,
    fetchedConferences:published.standingsByConference.size,
    failedConferences:published.failures,
    conferenceRows:built.conferences.length,
    assignments:built.assignments.length,
    unmatched:built.unmatched.length,
    ambiguous:built.ambiguous,
    plan
  };

  if(!built.assignments.length) return {status:"NO_MATCHES",...base};
  if(dryRun) return {status:"DRY_RUN",...base,d1Statements:0,conferenceWrites:0,teamWrites:0};

  const results=await env.DB.batch([
    conferenceUpsertStatement(env,built.conferences,checkedAt),
    teamMembershipUpdateStatement(env,built.assignments,checkedAt)
  ]);
  return {
    status:"SUCCESS",
    ...base,
    d1Statements:2,
    conferenceWrites:Number(results?.[0]?.meta?.changes||results?.[0]?.changes||0),
    teamWrites:Number(results?.[1]?.meta?.changes||results?.[1]?.changes||0)
  };
}

export { FETCH_BATCH_SIZE, localConferenceId };
