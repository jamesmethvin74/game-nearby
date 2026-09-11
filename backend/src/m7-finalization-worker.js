import app from "./logo-bootstrap-worker.js";
import { planM7VolleyballFinalization, executeM7VolleyballFinalization } from "./m7-volleyball-finalization.js";

export const M7_VOLLEYBALL_FINALIZATION_PLAN_PATH="/api/v1/internal/m7-vb-finalization-plan-7bc9c3e42f6a4f8b";
export const M7_VOLLEYBALL_FINALIZATION_EXECUTE_PATH="/api/v1/internal/m7-vb-finalization-execute-d34c08d0f6cf44a8";
export const M7_VOLLEYBALL_FINALIZATION_EXPIRES_AT=Date.parse("2026-09-12T06:00:00Z");

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
async function input(request){try{return await request.json();}catch{return {};}}

export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(Date.now()<=M7_VOLLEYBALL_FINALIZATION_EXPIRES_AT&&request.method==="GET"&&path===M7_VOLLEYBALL_FINALIZATION_PLAN_PATH){
      try{
        const plan=await planM7VolleyballFinalization(env);
        const {_private,...publicPlan}=plan;
        return json(publicPlan);
      }catch(error){
        console.error("M7 volleyball finalization plan failed",{error:String(error?.message||error)});
        return json({error:"m7_finalization_plan_failed",message:String(error?.message||error)},500);
      }
    }
    if(Date.now()<=M7_VOLLEYBALL_FINALIZATION_EXPIRES_AT&&request.method==="POST"&&path===M7_VOLLEYBALL_FINALIZATION_EXECUTE_PATH){
      const body=await input(request);
      if(body.approved_scope!=="m7-volleyball-finalization-approved") return json({error:"approved_scope_required"},409);
      if(!String(body.plan_fingerprint||"").startsWith("m7-finalize-")) return json({error:"plan_fingerprint_required"},409);
      try{
        return json(await executeM7VolleyballFinalization(env,{expectedFingerprint:body.plan_fingerprint}));
      }catch(error){
        console.error("M7 volleyball finalization execute failed",{error:String(error?.message||error)});
        return json({error:"m7_finalization_execute_failed",message:String(error?.message||error)},409);
      }
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){return app.scheduled(controller,env,ctx);}
};
