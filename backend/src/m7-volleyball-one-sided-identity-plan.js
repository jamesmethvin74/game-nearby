import { dateKeyInZone, normalizeSchoolAlias } from "./schedule-authority-core.js";
import { maxPrepsScoresUrl, matchLocalVolleyballTeams, parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";

const TIME_ZONE="America/Chicago";
const START="2026-08-01";

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}
function offset(localDate,days){const [y,m,d]=localDate.split("-").map(Number);return new Intl.DateTimeFormat("en-CA",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Date.UTC(y,m-1,d+days,18)));}
function datesThrough(end){const rows=[];for(let d=START,n=0;d<=end&&n<130;d=offset(d,1),n++)rows.push(d);return rows;}
function clean(value=""){return String(value).toLowerCase().replace(/homeschool/g,"home school").replace(/\bprep\b/g,"preparatory").replace(/\bsr\.?\b|\bsenior\b|\bjr\.?\b|\bjunior\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function aliases(row){
  const base=[row.school_name,row.raw_school_name,row.location_matched_name].filter(Boolean);
  const out=new Set();
  for(const value of base){
    const candidates=[value,String(value).replace(/^the\s+/i,""),String(value).replace(/\bcollegiate\b/ig," "),String(value).replace(/\b(?:arts?|science|magnet|conversion|charter)\b/ig," ")];
    for(const candidate of candidates){const key=normalizeSchoolAlias(clean(candidate));if(key)out.add(key);}
  }
  return [...out];
}
function sourceState(sourceUrl,observedName){
  try{
    const url=new URL(sourceUrl);
    if(url.pathname.includes("/ar/volleyball/match/")) return "AR";
    const match=url.pathname.match(/\/inter-state\/volleyball\/match\/([^/]+)\//);
    if(!match)return null;
    const pieces=match[1].split("-vs-");
    if(pieces.length!==2)return null;
    const observedTokens=new Set(clean(observedName).split(" ").filter(Boolean));
    const scored=pieces.map(piece=>{
      const state=piece.match(/-([a-z]{2})$/i)?.[1]?.toUpperCase()||null;
      const tokens=new Set(clean(piece.replace(/-[a-z]{2}$/i," ")).split(" ").filter(Boolean));
      let overlap=0;for(const token of observedTokens)if(tokens.has(token))overlap++;
      return {state,overlap,piece};
    }).sort((a,b)=>b.overlap-a.overlap);
    return scored[0].overlap>0&&scored[0].overlap>scored[1].overlap?scored[0].state:null;
  }catch{return null;}
}
function similarity(name,row){
  const a=new Set(clean(name).split(" ").filter(Boolean)),b=new Set(clean(row.school_name).split(" ").filter(Boolean));
  if(!a.size||!b.size)return 0;let shared=0;for(const token of a)if(b.has(token))shared++;
  return shared/Math.max(a.size,b.size);
}
async function zeroRead(env,sql,args=[]){const result=await env.DB.prepare(sql).bind(...args).all();if(rowsWritten(result)!==0)throw new Error("identity planner wrote to D1");return {rows:result.results||[],meta:{rows_read:rowsRead(result),rows_written:0}};}

export async function planM7OneSidedIdentity(env,{fetchFn=fetch,now=new Date()}={}){
  const through=dateKeyInZone(now.toISOString(),TIME_ZONE);
  const teams=await zeroRead(env,`
    SELECT t.id AS team_id,t.school_id,s.name AS raw_school_name,s.location_matched_name,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,s.city,s.state
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    ORDER BY t.id`);
  const identities=await zeroRead(env,`
    SELECT sei.external_school_id,sei.school_id,sei.observed_name,s.catalog_scope,
      t.id AS local_team_id
    FROM school_external_identities sei
    JOIN schools s ON s.id=sei.school_id
    LEFT JOIN teams t ON t.school_id=s.id AND t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
    WHERE sei.provider='maxpreps'`);
  const identityByExternal=new Map(identities.rows.map(row=>[String(row.external_school_id),row]));
  const aliasMap=new Map();
  for(const team of teams.rows)for(const key of aliases(team)){if(!aliasMap.has(key))aliasMap.set(key,new Map());aliasMap.get(key).set(team.school_id,team);}
  const pages=datesThrough(through);const oneSided=[];let parsed=0,matched=0,ambiguous=0;
  for(let i=0;i<pages.length;i+=5){
    const batch=await Promise.all(pages.slice(i,i+5).map(async localDate=>{const url=maxPrepsScoresUrl(localDate),response=await fetchFn(url,{headers:{"user-agent":"LocalBleachersAR-m7-identity/1.0","accept":"text/html"}});if(!response.ok)throw new Error(`MaxPreps HTTP ${response.status} ${localDate}`);return {localDate,rows:parseMaxPrepsVolleyballScores(await response.text(),{localDate,sourceUrl:response.url||url})};}));
    for(const page of batch){parsed+=page.rows.length;const result=matchLocalVolleyballTeams(page.rows,teams.rows);matched+=result.matched.length;ambiguous+=result.ambiguous.length;oneSided.push(...result.oneSided);}
  }
  const rows=[];
  for(const final of oneSided){
    const unresolved=final[final.unresolvedSide];const externalId=String(unresolved.maxprepsId||"");
    const known=identityByExternal.get(externalId)||null;
    const key=normalizeSchoolAlias(clean(unresolved.name));const exact=[...(aliasMap.get(key)?.values()||[])];
    const state=sourceState(final.sourceUrl,unresolved.name);
    let classification="unresolved";let resolvedTeam=null;let reason="";
    if(known?.local_team_id){classification="local";resolvedTeam=teams.rows.find(row=>row.team_id===known.local_team_id)||null;reason="existing_maxpreps_identity";}
    else if(known?.catalog_scope==="opponent-only"){classification="external";reason="existing_opponent_identity";}
    else if(exact.length===1){classification="local";resolvedTeam=exact[0];reason="unique_local_alias";}
    else if(state&&state!=="AR"){classification="external";reason=`url_state_${state}`;}
    else if(state==="AR"){classification="local_unresolved";reason=exact.length>1?"arkansas_alias_ambiguous":"arkansas_alias_missing";}
    const suggestions=classification==="local_unresolved"?[...teams.rows].map(team=>({team_id:team.team_id,school_id:team.school_id,school_name:team.school_name,score:similarity(unresolved.name,team)})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,5):[];
    rows.push({contest_id:final.contestId,local_date:final.localDate,source_url:final.sourceUrl,unresolved_side:final.unresolvedSide,observed_name:unresolved.name,maxpreps_id:externalId,state_hint:state,classification,reason,resolved_team_id:resolvedTeam?.team_id||null,resolved_school_id:resolvedTeam?.school_id||known?.school_id||null,suggestions});
  }
  const unique=new Map();for(const row of rows){const key=`${row.maxpreps_id}|${row.observed_name}`;if(!unique.has(key))unique.set(key,{...row,contests:0});unique.get(key).contests++;}
  const counts={};for(const row of rows)counts[row.classification]=(counts[row.classification]||0)+1;
  const meta=[teams.meta,identities.meta];
  return {generated_at:new Date().toISOString(),through_local_date:through,d1:{statements:2,rows_read:meta.reduce((s,r)=>s+r.rows_read,0),rows_written:0,per_statement:meta},authority:{dates:pages.length,parsed_finals:parsed,matched_local_local:matched,one_sided:rows.length,ambiguous},counts,unique_opponents:[...unique.values()].sort((a,b)=>a.classification.localeCompare(b.classification)||b.contests-a.contests||a.observed_name.localeCompare(b.observed_name)),invariants:{production_write_performed:false}};
}
