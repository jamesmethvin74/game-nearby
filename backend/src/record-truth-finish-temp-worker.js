import app from "./m8-worker.js";
import { planRecordTruthProductionRepair, executeRecordTruthProductionRepair } from "./record-truth-production-repair.js";
import { buildStatewideRecordTruthAudit } from "./record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./record-truth-audit-output.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

const MARKER_PATH="/api/v1/internal/record-truth-finish-marker-ab1d996b";
const PLAN_PATH="/api/v1/internal/record-truth-finish-plan-ab1d996b";
const EXECUTE_PATH="/api/v1/internal/record-truth-finish-execute-ab1d996b";
const MATERIALIZE_PATH="/api/v1/internal/record-truth-finish-materialize-ab1d996b";
const AUDIT_PATH="/api/v1/internal/record-truth-finish-audit-ab1d996b";
const BEEBE_CANONICAL="ce:volleyball:girls:2026:df-hrdb8f:df-jufft8:20260824:t1630";
const NLR_TEAM="df-hrdb8f-volleyball-2026";
const BEEBE_TEAM="df-jufft8-volleyball-2026";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function rowsWritten(result){return Number(result?.meta?.rows_written||result?.meta?.changes||0);}

async function finishPartialBeebeMaterialization(env){
  const plan=await planRecordTruthProductionRepair(env);
  const beebe=plan.cases.find(item=>item.key==="north-little-rock-beebe-20260824");
  if(!plan.safe||beebe?.action!=="already_complete") throw new Error(`Beebe canonical is not in the exact repaired state: ${JSON.stringify({safe:plan.safe,action:beebe?.action,reasons:plan.reasons})}`);

  const active=await env.DB.prepare("SELECT COUNT(*) AS n FROM event_conflicts WHERE canonical_event_id=? AND resolved_at IS NULL").bind(BEEBE_CANONICAL).first();
  if(Number(active?.n||0)!==0) throw new Error(`Beebe still has ${active?.n||0} active conflicts`);

  const now=new Date().toISOString();
  const conflictCountWrite=await env.DB.prepare(`
    UPDATE canonical_events SET conflict_count=0,updated_at=?
    WHERE id=? AND home_school_id='df-jufft8' AND away_school_id='df-hrdb8f'
      AND status='FINAL' AND home_score=3 AND away_score=0
      AND conflict_count<>0
  `).bind(now,BEEBE_CANONICAL).run();
  const conflictCountRows=rowsWritten(conflictCountWrite);
  if(conflictCountRows>1) throw new Error(`conflict-count write fuse ${conflictCountRows}/1`);

  const recordResult=await rebuildTeamRecords(env,[NLR_TEAM,BEEBE_TEAM],now);
  if(Number(recordResult?.teams||0)!==2) throw new Error(`record rebuild team fuse ${recordResult?.teams||0}/2`);

  const recordQuery=await env.DB.prepare(`
    SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at
    FROM team_records WHERE team_id IN (?,?) ORDER BY team_id
  `).bind(NLR_TEAM,BEEBE_TEAM).all();
  const records=recordQuery.results||[];
  if(records.length!==2) throw new Error(`record verification count ${records.length}/2`);

  const verification=await planRecordTruthProductionRepair(env);
  if(!verification.safe||verification.cases.some(item=>item.action!=="already_complete")) throw new Error(`post-materialization plan unsafe: ${JSON.stringify(verification.reasons)}`);
  return {status:"SUCCESS",repair_version:"record-truth-six-games-v2",conflict_count_rows_written:conflictCountRows,record_result:recordResult,records,verification:{fingerprint:verification.fingerprint,d1:verification.d1,cases:verification.cases.map(item=>({key:item.key,action:item.action}))}};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname===MARKER_PATH){
      return json({marker:"record-truth-finish-temp-v2-8a90e172",repair_version:"record-truth-six-games-v2",d1_access:false,rows_written:0});
    }
    if(request.method==="GET"&&url.pathname===PLAN_PATH){
      try{return json(await planRecordTruthProductionRepair(env));}
      catch(error){return json({error:"record_truth_repair_plan_failed",message:String(error?.message||error)},500);}
    }
    if(request.method==="POST"&&url.pathname===EXECUTE_PATH){
      try{
        const body=await request.json().catch(()=>({}));
        return json(await executeRecordTruthProductionRepair(env,{fingerprint:body?.fingerprint||null}));
      }catch(error){return json({error:"record_truth_repair_execute_failed",message:String(error?.message||error)},500);}
    }
    if(request.method==="POST"&&url.pathname===MATERIALIZE_PATH){
      try{return json(await finishPartialBeebeMaterialization(env));}
      catch(error){return json({error:"record_truth_materialize_failed",message:String(error?.message||error)},500);}
    }
    if(request.method==="GET"&&url.pathname===AUDIT_PATH){
      try{return json(finalizeRecordTruthAudit(await buildStatewideRecordTruthAudit(env,{season:"2026"})));}
      catch(error){return json({error:"record_truth_audit_failed",message:String(error?.message||error)},500);}
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){return app.scheduled(controller,env,ctx);}
};

export { MARKER_PATH, PLAN_PATH, EXECUTE_PATH, MATERIALIZE_PATH, AUDIT_PATH };
