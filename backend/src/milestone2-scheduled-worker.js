import app from "./public-cors-worker.js";
import core from "./index.js";
import { ensureStatewideSchema } from "./schema-bootstrap.js";
import { syncArkansasSchoolLocations } from "./arkansas-school-locations.js";
import { syncMaxPrepsSchoolBranding, enrichMaxPrepsSchoolMascots } from "./school-branding.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runScopedCadence } from "./scoped-cadence-runner.js";
import { syncCertifiedDragonFlySportCatalog } from "./dragonfly-certified-sport-catalog.js";
import { runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { STATEWIDE_HIGH_SCHOOL_SPORTS, statewideSportConfig } from "./statewide-sport-config.js";
import { runResilientHootensStatewideResults } from "./hootens-resilient-results.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { datesForMaxPrepsVolleyballFallback, runMaxPrepsVolleyballResultFallback } from "./maxpreps-volleyball-result-collector.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";
import { runApprovedVolleyballProductionConvergence } from "./approved-volleyball-production-convergence.js";

export function m2StatewideKeysForPlan(plan){
  if (!plan) return [];
  if (plan.kind==="friday-football-results") return ["football-boys"];
  if (plan.runStatewide) return STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>config.key);
  return [];
}

export function shouldRunOfficialFinalResults(plan){
  return plan?.kind==="friday-football-results"
    || plan?.kind==="morning-results"
    || plan?.kind==="evening-results"
    || Boolean(plan?.runVolleyballLive);
}

export function shouldRunVolleyballLiveResults(plan){
  return Boolean(plan?.runVolleyballLive);
}

export function officialFinalResultsScope(plan){
  const broad = plan?.kind==="friday-football-results"
    || plan?.kind==="morning-results"
    || plan?.kind==="evening-results";
  return broad ? "high-school-final-results" : "high-school-volleyball-final-results";
}

export function shouldRunHootensStatewideResults(plan){
  return plan?.kind==="friday-football-results" || plan?.kind==="morning-results";
}

async function runCatalogMaintenance(env){
  await ensureStatewideSchema(env);
  const payloads=new Map();
  const catalogs=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    try {
      const result=await syncCertifiedDragonFlySportCatalog(env,config);
      if (result.payload) payloads.set(config.key,result.payload);
      catalogs.push({key:config.key,status:result.status,mapped:result.mapped??null,mappedSchools:result.mappedSchools??null,quarantined:result.quarantined??null,pagesFetched:result.pagesFetched??null});
    } catch (error) {
      const message=String(error?.message||error);
      catalogs.push({key:config.key,status:"FAILURE",error:message});
      console.error("weekly certified DragonFly catalog sync failed",{sport:config.key,error:message});
    }
  }
  console.log("weekly certified DragonFly catalogs",catalogs);

  // Conference membership is catalog data, not live-result data. Refresh it once
  // during weekly maintenance after the certified team catalog exists and before
  // statewide collection rebuilds records from those memberships.
  try {
    const membership=await syncPublishedVolleyballConferenceMembership(env);
    console.log("weekly published volleyball conference membership",{
      status:membership.status,
      discoveredConferences:membership.discoveredConferences,
      fetchedConferences:membership.fetchedConferences,
      conferenceRows:membership.conferenceRows??0,
      assignments:membership.assignments,
      unmatched:membership.unmatched,
      ambiguous:Array.isArray(membership.ambiguous)?membership.ambiguous.length:0,
      conferenceWrites:membership.conferenceWrites??0,
      teamWrites:membership.teamWrites??0
    });
  } catch (error) {
    console.error("weekly published volleyball conference membership sync failed",String(error?.message||error));
  }

  try {
    const locations=await syncArkansasSchoolLocations(env);
    console.log("weekly statewide school locations",{
      status:locations.status,targetSchools:locations.targetSchools,matchedSchools:locations.matchedSchools,
      unresolvedSchools:locations.unresolvedSchools,ambiguousSchools:locations.ambiguousSchools,matchRatio:locations.matchRatio
    });
  } catch (error) {
    console.error("weekly statewide school location sync failed",String(error?.message||error));
  }

  try {
    const branding=await syncMaxPrepsSchoolBranding(env);
    const mascots=await enrichMaxPrepsSchoolMascots(env,{limit:20});
    console.log("weekly statewide school branding",{branding,mascots});
  } catch (error) {
    console.error("weekly statewide school branding sync failed",String(error?.message||error));
  }

  return payloads;
}

async function ensureFridayFootballCatalog(env){
  const config=statewideSportConfig("FB");
  try {
    const result=await syncCertifiedDragonFlySportCatalog(env,config,{maxAgeHours:24});
    return result.payload||null;
  } catch (error) {
    console.error("Friday football certified catalog sync failed",String(error?.message||error));
    return null;
  }
}

async function runStatewideSports(env,{keys,payloads=new Map(),reason="scheduled"}){
  const outcomes=[];
  for (const key of keys) {
    const config=statewideSportConfig(key);
    try {
      const result=await runCertifiedDragonFlyStatewideCollection(env,config,{payload:payloads.get(config.key)||null});
      outcomes.push({key,status:result.status,events:result.rawEventCount,observations:result.observations,canonicalEvents:result.canonicalEvents,touchedTeams:result.touchedTeams,pagesFetched:result.pagesFetched});
    } catch (error) {
      const message=String(error?.message||error);
      outcomes.push({key,status:"FAILURE",error:message});
      console.error("certified statewide collection failed",{reason,sport:key,error:message});
    }
  }
  try {
    await env.DB.prepare("UPDATE sources SET enabled=0 WHERE collection_mode='statewide'").run();
  } catch (error) {
    console.warn("statewide source cleanup failed",String(error?.message||error));
  }
  console.log("certified statewide collection",{reason,outcomes});
  return outcomes;
}

async function runOfficialFinalResultsPass({controller,env,ctx,plan}){
  if (!shouldRunOfficialFinalResults(plan)) return null;
  const scope=officialFinalResultsScope(plan);
  const activeResultMinutes=scope==="high-school-volleyball-final-results"
    ? Number(plan?.activeResultMinutes||30)
    : plan?.kind==="friday-football-results"?30:120;
  return runScopedCadence({
    core,env,ctx,controller,
    plan:{kind:`${plan.kind}-official-finals`,runCore:true,scope,activeResultMinutes}
  });
}

async function runHootensFinalResultsPass({env,plan}){
  if (!shouldRunHootensStatewideResults(plan)) return null;
  return runResilientHootensStatewideResults(env);
}

async function runVolleyballLiveResultsPass({env,plan,when}){
  if (!shouldRunVolleyballLiveResults(plan)) return null;
  try {
    const result=await runVolleyballLiveResultProbe(env,{now:when});
    console.log("volleyball semantic live result probe",{
      status:result.status,
      events:result.rawEventCount,
      touchedTeams:result.touchedTeams??null,
      pagesFetched:result.pagesFetched,
      d1Writes:result.d1Writes??null
    });
    return result;
  } catch (error) {
    const message=String(error?.message||error);
    console.error("volleyball semantic live result probe failed",message);
    return {status:"FAILURE",error:message};
  }
}

async function runMaxPrepsVolleyballFallbackPass({env,plan,when}){
  const dates=datesForMaxPrepsVolleyballFallback(plan,when);
  if(!dates.length) return null;
  try {
    const result=await runMaxPrepsVolleyballResultFallback(env,{dates,now:when});
    console.log("MaxPreps volleyball result fallback",{
      status:result.status,
      dates:result.dates,
      pagesFetched:result.pagesFetched,
      parsedFinals:result.parsedFinals,
      matchedFinals:result.matchedFinals,
      touchedTeams:result.touchedTeams,
      writes:result.writes
    });
    return result;
  } catch(error) {
    const message=String(error?.message||error);
    console.error("MaxPreps volleyball result fallback failed",message);
    return {status:"FAILURE",dates,error:message};
  }
}

async function refreshSourceIdsThroughCore(env,ctx,sourceIds,reason){
  if(!env.REFRESH_TOKEN) throw new Error("REFRESH_TOKEN is not configured for bounded internal source refresh");
  const scoped=[...new Set((sourceIds||[]).map(value=>String(value||"").trim()).filter(Boolean))];
  if(!scoped.length || scoped.length>16) throw new Error(`invalid bounded internal source scope ${scoped.length}`);

  // Parser behavior changed while Conway's upstream HTML may be byte-identical.
  // Clear conditional validators only for the explicitly approved source so the
  // body is fetched and reparsed instead of a 304 preserving stale parsed rows.
  await env.DB.prepare(`
    UPDATE sources SET etag=NULL,last_modified=NULL
    WHERE id IN (SELECT value FROM json_each(?))
      AND (etag IS NOT NULL OR last_modified IS NOT NULL)
  `).bind(JSON.stringify(scoped)).run();

  const request=new Request("https://localbleachers.internal/api/v1/refresh",{
    method:"POST",
    headers:{
      "accept":"application/json",
      "content-type":"application/json",
      "x-refresh-token":String(env.REFRESH_TOKEN)
    },
    body:JSON.stringify({sourceIds:scoped})
  });
  const response=await core.fetch(request,env,ctx);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`bounded internal source refresh HTTP ${response.status}: ${JSON.stringify(payload)}`);
  console.log("bounded internal source refresh",{reason,sourceIds:scoped,outcomes:payload?.outcomes||[]});
  return payload;
}

async function runApprovedProductionConvergence(env,ctx,when){
  try {
    const result=await runApprovedVolleyballProductionConvergence(env,{
      now:when,
      refreshSourceIds:(sourceIds,reason)=>refreshSourceIdsThroughCore(env,ctx,sourceIds,reason)
    });
    console.log("approved volleyball production convergence",{
      status:result.status,
      stateId:result.stateId,
      completedAt:result.completedAt||result.checkedAt||null,
      checks:result.checks||null
    });
    return result;
  } catch(error) {
    const message=String(error?.message||error);
    console.error("approved volleyball production convergence failed",message);
    return {status:"FAILURE",error:message};
  }
}

async function runScheduledPlan(controller,env,ctx){
  const scheduledTime=Number(controller?.scheduledTime);
  const when=Number.isFinite(scheduledTime)?new Date(scheduledTime):new Date();

  // Explicitly approved one-time production convergence. It is internally scoped,
  // idempotent, and records completion before becoming a no-op. This hook is removed
  // after live proof so normal cron retains no permanent repair overhead.
  const approvedConvergence=await runApprovedProductionConvergence(env,ctx,when);

  const plan=collectionPlanAt(when);
  if (!plan) {
    console.log("collection cadence tick skipped",{scheduledAt:when.toISOString()});
    return {status:"SKIPPED",approvedConvergence};
  }

  console.log("Milestone 2 collection cadence plan",{scheduledAt:when.toISOString(),...plan});
  let payloads=new Map();
  if (plan.runCatalogMaintenance) payloads=await runCatalogMaintenance(env);

  const statewideKeys=m2StatewideKeysForPlan(plan);
  if (plan.kind==="friday-football-results" && !payloads.has("football-boys")) {
    const footballPayload=await ensureFridayFootballCatalog(env);
    if (footballPayload) payloads.set("football-boys",footballPayload);
  }
  if (statewideKeys.length) await runStatewideSports(env,{keys:statewideKeys,payloads,reason:plan.kind});

  // DragonFly remains the first authority. The semantic probe is zero-write when
  // unchanged; the MaxPreps pass runs second and only persists finals that remain
  // missing or conflicting after DragonFly.
  const volleyballLiveResults=await runVolleyballLiveResultsPass({env,plan,when});
  const maxPrepsVolleyballResults=await runMaxPrepsVolleyballFallbackPass({env,plan,when});

  // Statewide authorities run first. If they resolve a final, the official-school
  // selector sees that game as no longer SCHEDULED and skips the redundant fetch.
  // During live volleyball windows the fallback is volleyball-only and capped at
  // 64 configured official result sources rather than using the football-sized sweep.
  const hootensFinalResults=await runHootensFinalResultsPass({env,plan});
  const officialFinalResults=await runOfficialFinalResultsPass({controller,env,ctx,plan});

  if (plan.runCore) {
    const scoped=await runScopedCadence({core,env,ctx,controller,plan});
    if (scoped) return {...scoped,approvedConvergence,statewideSports:statewideKeys,volleyballLiveResults,maxPrepsVolleyballResults,hootensFinalResults,officialFinalResults};
    const result=await core.scheduled({...controller,cron:`cadence:${plan.kind}`},env,ctx);
    return {status:"SUCCESS",plan:plan.kind,approvedConvergence,statewideSports:statewideKeys,volleyballLiveResults,maxPrepsVolleyballResults,hootensFinalResults,officialFinalResults,coreResult:result??null};
  }

  return {status:"SUCCESS",plan:plan.kind,approvedConvergence,statewideSports:statewideKeys,volleyballLiveResults,maxPrepsVolleyballResults,hootensFinalResults,officialFinalResults};
}

export default {
  async fetch(request,env,ctx){return app.fetch(request,env,ctx);},
  async scheduled(controller,env,ctx){return runScheduledPlan(controller,env,ctx);}
};
