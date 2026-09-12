import app from "./public-cors-worker.js";
import core from "./index.js";
import { ensureStatewideSchema } from "./schema-bootstrap.js";
import { syncArkansasSchoolLocations } from "./arkansas-school-locations.js";
import { syncMaxPrepsSchoolBranding, enrichMaxPrepsSchoolMascots } from "./school-branding.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runScopedCadence } from "./scoped-cadence-runner.js";
import { syncCertifiedDragonFlySportCatalog } from "./dragonfly-certified-sport-catalog.js";
import { runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { runStatewideLiveResultProbe } from "./statewide-live-results.js";
import { STATEWIDE_HIGH_SCHOOL_SPORTS, statewideSportConfig } from "./statewide-sport-config.js";
import { runResilientHootensStatewideResults } from "./hootens-resilient-results.js";
import { datesForMaxPrepsVolleyballFallback, runMaxPrepsVolleyballResultFallback } from "./maxpreps-volleyball-result-collector.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export function m2StatewideKeysForPlan(plan){
  if (!plan) return [];
  if (plan.kind==="friday-football-results") return ["football-boys"];
  if (plan.runStatewide) return STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>config.key);
  return [];
}

export function m2LiveStatewideKeysForPlan(plan){
  if (!plan) return [];
  const keys=Array.isArray(plan.liveStatewideSports)?plan.liveStatewideSports.filter(Boolean):[];
  if (keys.length) return [...new Set(keys)];
  // Backward-compatible fallback for older plan fixtures/callers.
  return plan.runVolleyballLive?["volleyball-girls"]:[];
}

export function shouldRunOfficialFinalResults(plan){
  return plan?.kind==="friday-football-results"
    || plan?.kind==="morning-results"
    || plan?.kind==="evening-results"
    || m2LiveStatewideKeysForPlan(plan).includes("volleyball-girls");
}

export function shouldRunVolleyballLiveResults(plan){
  return m2LiveStatewideKeysForPlan(plan).includes("volleyball-girls");
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

async function runStatewideLiveResultsPass({env,plan,when}){
  const keys=m2LiveStatewideKeysForPlan(plan);
  if (!keys.length) return [];
  const outcomes=[];
  for (const key of keys) {
    try {
      const result=await runStatewideLiveResultProbe(env,key,{
        now:when,
        acceptLegacySignature:key==="volleyball-girls",
        userAgent:`LocalBleachersAR-${key}-live/1.0`
      });
      outcomes.push({key,status:result.status,events:result.rawEventCount,touchedTeams:result.touchedTeams??0,pagesFetched:result.pagesFetched,d1Writes:result.d1Writes??null});
    } catch (error) {
      const message=String(error?.message||error);
      outcomes.push({key,status:"FAILURE",error:message});
      console.error("statewide semantic live result probe failed",{sport:key,error:message});
    }
  }
  console.log("statewide semantic live result probes",outcomes);
  return outcomes;
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

async function runScheduledPlan(controller,env,ctx){
  const scheduledTime=Number(controller?.scheduledTime);
  const when=Number.isFinite(scheduledTime)?new Date(scheduledTime):new Date();
  const plan=collectionPlanAt(when);
  if (!plan) {
    console.log("collection cadence tick skipped",{scheduledAt:when.toISOString()});
    return {status:"SKIPPED"};
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

  const statewideLiveResults=await runStatewideLiveResultsPass({env,plan,when});
  const volleyballLiveResults=statewideLiveResults.find(item=>item.key==="volleyball-girls")||null;
  const maxPrepsVolleyballResults=await runMaxPrepsVolleyballFallbackPass({env,plan,when});

  const hootensFinalResults=await runHootensFinalResultsPass({env,plan});
  const officialFinalResults=await runOfficialFinalResultsPass({controller,env,ctx,plan});

  if (plan.runCore) {
    const scoped=await runScopedCadence({core,env,ctx,controller,plan});
    if (scoped) return {...scoped,statewideSports:statewideKeys,statewideLiveResults,volleyballLiveResults,maxPrepsVolleyballResults,hootensFinalResults,officialFinalResults};
    const result=await core.scheduled({...controller,cron:`cadence:${plan.kind}`},env,ctx);
    return {status:"SUCCESS",plan:plan.kind,statewideSports:statewideKeys,statewideLiveResults,volleyballLiveResults,maxPrepsVolleyballResults,hootensFinalResults,officialFinalResults,coreResult:result??null};
  }

  return {status:"SUCCESS",plan:plan.kind,statewideSports:statewideKeys,statewideLiveResults,volleyballLiveResults,maxPrepsVolleyballResults,hootensFinalResults,officialFinalResults};
}

export default {
  async fetch(request,env,ctx){return app.fetch(request,env,ctx);},
  async scheduled(controller,env,ctx){return runScheduledPlan(controller,env,ctx);}
};
