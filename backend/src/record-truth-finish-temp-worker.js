import app from "./m8-worker.js";
import { planRecordTruthProductionRepair, executeRecordTruthProductionRepair } from "./record-truth-production-repair.js";
import { buildStatewideRecordTruthAudit } from "./record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./record-truth-audit-output.js";

const MARKER_PATH="/api/v1/internal/record-truth-finish-marker-ab1d996b";
const PLAN_PATH="/api/v1/internal/record-truth-finish-plan-ab1d996b";
const EXECUTE_PATH="/api/v1/internal/record-truth-finish-execute-ab1d996b";
const AUDIT_PATH="/api/v1/internal/record-truth-finish-audit-ab1d996b";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
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
    if(request.method==="GET"&&url.pathname===AUDIT_PATH){
      try{return json(finalizeRecordTruthAudit(await buildStatewideRecordTruthAudit(env,{season:"2026"})));}
      catch(error){return json({error:"record_truth_audit_failed",message:String(error?.message||error)},500);}
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){return app.scheduled(controller,env,ctx);}
};

export { MARKER_PATH, PLAN_PATH, EXECUTE_PATH, AUDIT_PATH };
