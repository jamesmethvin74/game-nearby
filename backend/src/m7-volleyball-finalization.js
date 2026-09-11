import { planM7StatewideFinalConvergence, executeM7StatewideFinalConvergence } from "./m7-volleyball-statewide-final-convergence.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
export { planDuplicateCanonicalMerges, planOrphanAttachments, planCoordinateUpdates } from "./m7-finalization-safety-helpers.js";

const APPROVED_THROUGH=new Date("2026-09-10T18:00:00Z");
const APPROVED_CONVERGENCE_FINGERPRINT="m7-statewide-finals-0b73d194";
const APPROVED_ROUTE_FINGERPRINT="m7-finalize-approved60-0b73d194";
const APPROVED_TOTAL=60;
const APPROVED_STALE=59;
const APPROVED_MISSING=1;
const MAX_TOUCHED_TEAMS=120;

function approved60(plan){
  return Boolean(plan?.safe_to_execute)
    && plan.plan_fingerprint===APPROVED_CONVERGENCE_FINGERPRINT
    && plan.through_local_date==="2026-09-10"
    && Number(plan.d1?.rows_written||0)===0
    && Number(plan.candidates?.total||0)===APPROVED_TOTAL
    && Number(plan.candidates?.stale||0)===APPROVED_STALE
    && Number(plan.candidates?.missing||0)===APPROVED_MISSING
    && Number(plan.candidates?.score_fill||0)===0;
}

export async function planM7VolleyballFinalization(env,{fetchFn=fetch}={}){
  const plan=await planM7StatewideFinalConvergence(env,{fetchFn,now:APPROVED_THROUGH});
  const { _private, ...publicPlan }=plan;
  return {
    ...publicPlan,
    safe_to_execute:approved60(plan),
    plan_fingerprint:APPROVED_ROUTE_FINGERPRINT,
    convergence_fingerprint:plan.plan_fingerprint,
    approved_scope:"60-final-result-convergence",
    approved_candidate_shape:{total:APPROVED_TOTAL,stale:APPROVED_STALE,missing:APPROVED_MISSING,score_fill:0}
  };
}

export async function executeM7VolleyballFinalization(env,{fetchFn=fetch,expectedFingerprint=null}={}){
  if(expectedFingerprint!==APPROVED_ROUTE_FINGERPRINT) throw new Error("Approved 60-result route fingerprint required");
  const preflight=await planM7StatewideFinalConvergence(env,{fetchFn,now:APPROVED_THROUGH});
  if(!approved60(preflight)) throw new Error(`Approved 60-result convergence scope changed: ${preflight.plan_fingerprint} ${JSON.stringify(preflight.candidates||{})}`);
  const touchedTeamIds=[...new Set((preflight._private?.safeObs||[]).map(row=>row.team_id).filter(Boolean))];
  if(!touchedTeamIds.length||touchedTeamIds.length>MAX_TOUCHED_TEAMS) throw new Error(`Touched-team fuse exceeded: ${touchedTeamIds.length}`);

  const convergence=await executeM7StatewideFinalConvergence(env,{fetchFn,now:APPROVED_THROUGH});
  if(convergence.status!=="SUCCESS"||convergence.plan_fingerprint!==APPROVED_CONVERGENCE_FINGERPRINT||Number(convergence.verified?.contests||0)!==APPROVED_TOTAL) {
    throw new Error("Approved 60-result convergence execution did not match the authorized scope");
  }

  const rebuilt=await rebuildTeamRecords(env,touchedTeamIds,new Date().toISOString());
  if(Number(rebuilt?.teams||0)!==touchedTeamIds.length) throw new Error(`Touched record rebuild mismatch: expected ${touchedTeamIds.length}, got ${rebuilt?.teams}`);

  const verification=await planM7StatewideFinalConvergence(env,{fetchFn,now:APPROVED_THROUGH});
  if(Number(verification.d1?.rows_written||0)!==0) throw new Error("Post-convergence verification wrote to D1");
  if(Number(verification.candidates?.total||0)!==0) throw new Error(`Safe final-result candidates remain: ${verification.candidates?.total}`);

  return {
    status:"SUCCESS",
    executed_scope:"60-final-result-convergence",
    route_fingerprint:APPROVED_ROUTE_FINGERPRINT,
    convergence_fingerprint:APPROVED_CONVERGENCE_FINGERPRINT,
    convergence:{
      verified:convergence.verified,
      repair_d1:convergence.d1?.repair||null,
      planner_d1:convergence.d1?.planner||null
    },
    touched_team_ids:touchedTeamIds,
    records:rebuilt,
    verification:{
      convergence_fingerprint:verification.plan_fingerprint,
      candidates:verification.candidates,
      d1:verification.d1
    }
  };
}

export const M7_FINALIZATION_LIMITS={APPROVED_TOTAL,APPROVED_STALE,APPROVED_MISSING,MAX_TOUCHED_TEAMS};
