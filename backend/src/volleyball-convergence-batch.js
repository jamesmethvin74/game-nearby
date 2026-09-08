import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";
import { runMaxPrepsVolleyballResultFallback } from "./maxpreps-volleyball-result-collector.js";

export const VOLLEYBALL_CONVERGENCE_PATH="/api/v1/internal/volleyball-convergence";
export const VOLLEYBALL_CONVERGENCE_BATCH_KEY="aug24-external-opponents-v1";
export const VOLLEYBALL_CONVERGENCE_SNAPSHOT_PROVIDER="maxpreps-audit-snapshot";
export const VOLLEYBALL_CONVERGENCE_AUDIT_RUN_ID=34172135818;

// Frozen source snapshot recovered from the successful statewide volleyball audit.
// This is intentionally limited to the three already-approved Aug. 24 contest IDs.
export const VOLLEYBALL_CONVERGENCE_BATCHES=Object.freeze({
  [VOLLEYBALL_CONVERGENCE_BATCH_KEY]:Object.freeze({
    dates:Object.freeze(["2026-08-24"]),
    contests:Object.freeze([
      Object.freeze({
        contestId:"bf452b95-43e9-412c-8bbc-80fcd92ca147",
        teamId:"df-ezw3f9-volleyball-2026",
        localSchool:"Marion High School",
        opponent:"Collierville",
        home:Object.freeze({externalId:"audit-marion",name:"Marion",score:3}),
        away:Object.freeze({externalId:"audit-collierville",name:"Collierville",score:1})
      }),
      Object.freeze({
        contestId:"01c9d8e3-fdea-4c12-879b-6a9f9726bb58",
        teamId:"df-26g9fq-volleyball-2026",
        localSchool:"Columbia Christian School",
        opponent:"Word of God Academy",
        home:Object.freeze({externalId:"audit-columbia-christian",name:"Columbia Christian",score:3}),
        away:Object.freeze({externalId:"audit-word-of-god-academy",name:"Word of God Academy",score:1})
      }),
      Object.freeze({
        contestId:"b3ba2de8-200c-412e-923e-7bad05699fd2",
        teamId:"df-kybtet-volleyball-2026",
        localSchool:"Magnolia High School",
        opponent:"Pleasant Grove",
        home:Object.freeze({externalId:"audit-magnolia",name:"Magnolia",score:1}),
        away:Object.freeze({externalId:"audit-pleasant-grove",name:"Pleasant Grove",score:3})
      })
    ])
  })
});

function escapeHtml(value="") { return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;"); }
function localDateFromScoresUrl(url) {
  const raw=new URL(String(url)).searchParams.get("date")||"";
  const match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!match) throw new Error("Bounded volleyball convergence received an unexpected MaxPreps date URL");
  return `${match[3]}-${match[1].padStart(2,"0")}-${match[2].padStart(2,"0")}`;
}
function selectedFinalHtml(finals) {
  const options=new Map();
  for(const final of finals){options.set(final.home.maxprepsId,final.home.name);options.set(final.away.maxprepsId,final.away.name);}
  const optionHtml=[...options.entries()].map(([id,name])=>`<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
  const cards=finals.map(final=>`<li class="c" data-teams="${escapeHtml(final.home.maxprepsId)},${escapeHtml(final.away.maxprepsId)}" data-contest-id="${escapeHtml(final.contestId)}"><div class="contest-box-item" data-contest-state="boxscore"><a href="${escapeHtml(final.sourceUrl)}" class="c-c"><ul class="teams"><li><div class="score">${Number(final.home.score)}</div><div class="name">${escapeHtml(final.home.name)}</div></li><li><div class="score">${Number(final.away.score)}</div><div class="name">${escapeHtml(final.away.name)}</div></li></ul><div class="details"> Final</div></a></div></li>`).join("");
  return `<!doctype html><html><body><select id="q_n_teams">${optionHtml}</select><ul>${cards}</ul></body></html>`;
}
function contestPairMatches(final,spec){const names=[normalizeSchoolAlias(final.home.name),normalizeSchoolAlias(final.away.name)];return names.includes(normalizeSchoolAlias(spec.localSchool))&&names.includes(normalizeSchoolAlias(spec.opponent));}

function auditedSnapshotFinals(batch) {
  const localDate=batch.dates[0];
  return batch.contests.map(spec=>({
    contestId:spec.contestId,
    localDate,
    sourceUrl:`https://www.maxpreps.com/ar/volleyball/scores/?date=8%2F24%2F2026#audit-${spec.contestId}`,
    home:{maxprepsId:spec.home.externalId,name:spec.home.name,score:spec.home.score},
    away:{maxprepsId:spec.away.externalId,name:spec.away.name,score:spec.away.score}
  }));
}

function makeAuditedSnapshotFetch(batch) {
  const finals=auditedSnapshotFinals(batch);
  return async url=>{
    const localDate=localDateFromScoresUrl(url);
    if(localDate!==batch.dates[0]) throw new Error(`Bounded volleyball convergence unexpected date ${localDate}`);
    return new Response(selectedFinalHtml(finals),{status:200,headers:{"content-type":"text/html; charset=utf-8"}});
  };
}

async function loadLocalScope(env,batch){
  const targetIds=[...new Set(batch.contests.map(row=>row.teamId))];
  const targetQuery=await env.DB.prepare(`SELECT t.id AS team_id,t.conference_id,COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.id IN (SELECT value FROM json_each(?)) AND t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND s.level='high-school' AND s.catalog_scope='local'`).bind(JSON.stringify(targetIds)).all();
  const targets=new Map((targetQuery.results||[]).map(row=>[String(row.team_id),row]));
  if(targets.size!==targetIds.length) throw new Error("Bounded volleyball convergence target-team preflight failed");
  const localQuery=await env.DB.prepare(`SELECT t.id AS team_id,COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND s.level='high-school' AND s.catalog_scope='local'`).all();
  const localAliases=new Set((localQuery.results||[]).map(row=>normalizeSchoolAlias(row.school_name)).filter(Boolean));
  for(const spec of batch.contests){
    const target=targets.get(spec.teamId);
    if(normalizeSchoolAlias(target?.school_name)!==normalizeSchoolAlias(spec.localSchool)) throw new Error(`Bounded volleyball convergence local identity changed for ${spec.contestId}`);
    if(target?.conference_id!=null&&String(target.conference_id)!=="") throw new Error(`Bounded volleyball convergence target now has conference membership for ${spec.contestId}`);
    if(localAliases.has(normalizeSchoolAlias(spec.opponent))) throw new Error(`Bounded volleyball convergence opponent is now local for ${spec.contestId}`);
  }
  return {targetTeams:targetIds.length,localTeams:localQuery.results?.length||0,conferenceCohorts:0};
}

function makeContestFilteredFetch(batch,fetchFn){
  const specByContest=new Map(batch.contests.map(row=>[row.contestId,row]));
  return async(url,init)=>{
    const response=await fetchFn(url,init); if(!response.ok) return response;
    const localDate=localDateFromScoresUrl(url); if(localDate!==batch.dates[0]) throw new Error(`Bounded volleyball convergence unexpected date ${localDate}`);
    const parsed=parseMaxPrepsVolleyballScores(await response.text(),{localDate,sourceUrl:response.url||url});
    const expected=new Set(batch.contests.map(row=>row.contestId)); const selected=parsed.filter(final=>expected.has(final.contestId)); const found=new Set(selected.map(final=>final.contestId));
    if(found.size!==expected.size||[...expected].some(id=>!found.has(id))) throw new Error(`Bounded volleyball convergence source page is missing an approved contest for ${localDate}`);
    for(const final of selected){const spec=specByContest.get(final.contestId);if(!spec||!contestPairMatches(final,spec)) throw new Error(`Bounded volleyball convergence pairing changed for ${final.contestId}`);}
    return new Response(selectedFinalHtml(selected),{status:200,headers:{"content-type":"text/html; charset=utf-8"}});
  };
}

export async function diagnoseVolleyballConvergenceBatch(env,{batchKey=VOLLEYBALL_CONVERGENCE_BATCH_KEY}={}){
  const batch=VOLLEYBALL_CONVERGENCE_BATCHES[String(batchKey||"")];
  if(!batch) throw new Error("Unknown volleyball convergence batch");
  if(batch.contests.length>3||batch.dates.length!==1) throw new Error("Volleyball convergence batch exceeds hard safety bounds");
  const preflight=await loadLocalScope(env,batch);
  const snapshotFetch=makeAuditedSnapshotFetch(batch);
  const sourceResponse=await snapshotFetch(`https://www.maxpreps.com/ar/volleyball/scores/?date=8%2F24%2F2026`);
  const selected=parseMaxPrepsVolleyballScores(await sourceResponse.text(),{localDate:batch.dates[0]});
  return {
    batchKey,
    auditRunId:VOLLEYBALL_CONVERGENCE_AUDIT_RUN_ID,
    preflight,
    source:{
      mode:"audited-snapshot",
      selectedFinals:selected.length,
      approvedContestIds:selected.map(row=>row.contestId),
      scores:selected.map(row=>({contestId:row.contestId,home:row.home.name,homeScore:row.home.score,away:row.away.name,awayScore:row.away.score}))
    }
  };
}

export async function runVolleyballConvergenceBatch(env,{batchKey,now=new Date(),runner=runMaxPrepsVolleyballResultFallback}={}){
  const batch=VOLLEYBALL_CONVERGENCE_BATCHES[String(batchKey||"")]; if(!batch) throw new Error("Unknown volleyball convergence batch");
  if(batch.contests.length>3||batch.dates.length!==1) throw new Error("Volleyball convergence batch exceeds hard safety bounds");
  const preflight=await loadLocalScope(env,batch); const targetTeamIds=[...new Set(batch.contests.map(row=>row.teamId))];
  const result=await runner(env,{
    dates:[...batch.dates],
    targetTeamIds,
    fetchFn:makeAuditedSnapshotFetch(batch),
    now,
    opponentIdentityProvider:VOLLEYBALL_CONVERGENCE_SNAPSHOT_PROVIDER
  });
  if(Number(result?.matchedFinals||0)>3||Number(result?.observations||0)>3||Number(result?.touchedTeams||0)>3||Number(result?.recordResult?.standings?.cohorts||0)>0) throw new Error("Volleyball convergence result exceeded approved logical bounds");
  return {
    batchKey,
    auditRunId:VOLLEYBALL_CONVERGENCE_AUDIT_RUN_ID,
    sourceMode:"audited-snapshot",
    approvedContestIds:batch.contests.map(row=>row.contestId),
    approvedTeamIds:targetTeamIds,
    preflight,
    result
  };
}

export { auditedSnapshotFinals, localDateFromScoresUrl, makeAuditedSnapshotFetch, makeContestFilteredFetch, selectedFinalHtml };
