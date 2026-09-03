import { runM2ProductionBootstrap } from "./m2-production-bootstrap.js";

export const M2_BOOTSTRAP_V2_READY_PATH="/api/v1/_m2-bootstrap-v2-ready-20260903";
export const M2_BOOTSTRAP_V2_RUN_PATH="/api/v1/_m2-bootstrap-v2-run-20260903-1102";
const HEADER="x-localbleachers-m2-bootstrap";
const HEADER_VALUE="approved-certified-1102-20260903";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

export async function maybeHandleM2ProductionBootstrapV2(request,env){
  const url=new URL(request.url);
  if (request.method!=="GET") return null;
  if (url.pathname===M2_BOOTSTRAP_V2_READY_PATH) {
    return json({ready:true,release:"m2-production-bootstrap-unique-v2-20260903"});
  }
  if (url.pathname!==M2_BOOTSTRAP_V2_RUN_PATH) return null;
  if (request.headers.get(HEADER)!==HEADER_VALUE) return json({error:"not_found"},404);
  const result=await runM2ProductionBootstrap(env);
  return json(result,result.status==="SUCCESS"?200:409);
}
