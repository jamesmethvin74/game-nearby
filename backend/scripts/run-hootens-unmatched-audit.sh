#!/usr/bin/env bash
set -euo pipefail

WRAPPER="src/_hootens-unmatched-audit.mjs"
trap 'rm -f "$WRAPPER"' EXIT

npm run check
node --check src/hootens-unmatched-audit.js

cat > "$WRAPPER" <<'EOF'
import { auditHootensUnmatched } from "./hootens-unmatched-audit.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*"}
  });
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="GET" || url.pathname!=="/api/hootens-unmatched-report") return json({error:"not_found"},404);
    try {
      const result=await auditHootensUnmatched(env);
      return json(result);
    } catch(error) {
      return json({status:"FAILURE",error:String(error?.message||error)},500);
    }
  }
};
EOF

wrangler versions upload "$WRAPPER" --preview-alias "hootens-unmatched-audit" --keep-vars
