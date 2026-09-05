#!/usr/bin/env bash
set -euo pipefail

PROBE_WRAPPER="src/_hootens-parser-probe.mjs"
RESULT_WRAPPER="src/_hootens-parser-result.mjs"
PROBE_ALIAS="hootens-parser-probe2"
PROBE_API="https://${PROBE_ALIAS}-localbleachersar-sports-api.james-methvin74.workers.dev"
TMPDIR="$(mktemp -d)"
trap 'rm -f "$PROBE_WRAPPER" "$RESULT_WRAPPER"; rm -rf "$TMPDIR"' EXIT

cat > "$PROBE_WRAPPER" <<'EOF'
import { probeHootensScoreboard } from "./hootens-statewide-results.js";
export default {async fetch(){
  try {
    const result=await probeHootensScoreboard();
    return new Response(JSON.stringify({status:"OK",...result}),{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  } catch(error) {
    return new Response(JSON.stringify({status:"ERROR",error:String(error?.message||error)}),{status:500,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  }
}};
EOF

wrangler versions upload "$PROBE_WRAPPER" --preview-alias "$PROBE_ALIAS" --keep-vars >/dev/null
OUT="$TMPDIR/probe.json"
CODE="000"
for ATTEMPT in $(seq 1 30); do
  CODE="$(curl -sS --max-time 30 -o "$OUT" -w '%{http_code}' "$PROBE_API" || true)"
  if [ "$CODE" = "200" ] || [ "$CODE" = "500" ]; then break; fi
  sleep 2
done
[ -s "$OUT" ] || printf '{"status":"ERROR","error":"probe-http-%s"}' "$CODE" > "$OUT"

ALIAS="$(node - "$OUT" "$CODE" <<'NODE'
const fs=require('fs');
let p={}; try{p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));}catch{}
const code=process.argv[3]||'000';
function clean(s){return String(s||'').toLowerCase();}
let marker='';
if(p.status==='OK'){
  let c='x';
  if(p.conway){const n=[Number(p.conway.homeScore),Number(p.conway.awayScore)].filter(Number.isFinite).sort((a,b)=>a-b);c=n.length===2?`f${n[0]}x${n[1]}`:'x';}
  marker=`p${Number(p.finals||0)}c${c}`;
}else{
  const e=clean(p.error);
  let cat='uk';
  if(e.includes('hooten archive http'))cat='ah';
  else if(e.includes('current scoreboard link not found'))cat='al';
  else if(e.includes('hooten scoreboard http'))cat='sh';
  else if(e.includes('htmlrewriter unavailable'))cat='hr';
  else if(e.includes('zero finals'))cat='zf';
  else if(e.includes('probe-http'))cat='ph';
  marker=`e${cat}${code}`;
}
console.log(`hp-${marker}`.slice(0,34));
NODE
)"

node - "$OUT" "$CODE" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs');
let probe={}; try{probe=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));}catch(error){probe={status:'ERROR',error:String(error)}}
probe.httpCode=process.argv[3];
const body=JSON.stringify(probe);
process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(body)},{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}};\n`);
NODE

wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars
