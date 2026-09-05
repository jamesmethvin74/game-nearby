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

export function m2StatewideKeysForPlan(plan){
  if (!plan) return [];
  if (plan.kind==="friday-football-results") return ["football-boys"];
  if (plan.runStatewide) return STATEWIDE_HIGH_SCHOOL_SPORTS.map(config=>config.key);
  return [];
}

export function shouldRunOfficialFinalResults(plan){
  return plan?.kind==="friday-football-results" || plan?.kind==="morning-results" || plan?.kind==="evening-results";
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
  const activeResultMinutes=plan?.kind==="friday-football-results"?30:120;
  return runScopedCadence({
    core,env,ctx,controller,
    plan:{kind:`${plan.kind}-official-finals`,runCore:true,scope:"high-school-final-results",activeResultMinutes}
  });
}

async function runHootensFinalResultsPass({env,plan}){
  if (!shouldRunHootensStatewideResults(plan)) return null;
  return runResilientHootensStatewideResults(env);
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

  // Hooten is a single statewide result surface. Run it before the per-school
  // fallback so successfully resolved finals disappear from that fallback's
  // finished-but-still-SCHEDULED selector. The resilient finalizer is idempotent:
  // it skips exact finals already persisted and repairs only the bounded remainder.
  const hootensFinalResults=await runHootensFinalResultsPass({env,plan});
  const officialFinalResults=await runOfficialFinalResultsPass({controller,env,ctx,plan});

  if (plan.runCore) {
    const scoped=await runScopedCadence({core,env,ctx,controller,plan});
    if (scoped) return {...scoped,statewideSports:statewideKeys,hootensFinalResults,officialFinalResults};
    const result=await core.scheduled({...controller,cron:`cadence:${plan.kind}`},env,ctx);
    return {status:"SUCCESS",plan:plan.kind,statewideSports:statewideKeys,hootensFinalResults,officialFinalResults,coreResult:result??null};
  }

  return {status:"SUCCESS",plan:plan.kind,statewideSports:statewideKeys,hootensFinalResults,officialFinalResults};
}

export default {
  async fetch(request,env,ctx){return app.fetch(request,env,ctx);},
  async scheduled(controller,env,ctx){return runScheduledPlan(controller,env,ctx);}
};
