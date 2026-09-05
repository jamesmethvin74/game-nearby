#!/usr/bin/env bash
set -euo pipefail

WRAPPER="src/_hootens-unmatched-audit.mjs"
TMPDIR="$(mktemp -d)"
trap 'rm -f "$WRAPPER"; rm -rf "$TMPDIR"' EXIT
REPORT="$TMPDIR/report.json"
AUDIT_ALIAS="hootens-unmatched-audit"
AUDIT_URL="https://${AUDIT_ALIAS}-localbleachersar-sports-api.james-methvin74.workers.dev/api/hootens-unmatched-report"

npm run check
node --check src/hootens-unmatched-audit.js

cat > "$WRAPPER" <<'EOF'
import { auditHootensUnmatched } from "./hootens-unmatched-audit.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(request.method!=="GET" || url.pathname!=="/api/hootens-unmatched-report") return json({error:"not_found"},404);
  try{return json(await auditHootensUnmatched(env));}
  catch(error){return json({status:"FAILURE",error:String(error?.message||error)},500);}
}};
EOF

wrangler versions upload "$WRAPPER" --preview-alias "$AUDIT_ALIAS" --keep-vars >/dev/null

CODE=""
for ATTEMPT in $(seq 1 20); do
  CODE="$(curl -sS --max-time 45 -o "$REPORT" -w '%{http_code}' "$AUDIT_URL" || true)"
  if [ "$CODE" = "200" ] && node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(p?.status==="SUCCESS"?0:1)}catch{process.exit(1)}' "$REPORT"; then
    break
  fi
  sleep 2
done
if [ "$CODE" != "200" ]; then
  echo "Hooten unmatched audit endpoint failed: HTTP $CODE" >&2
  head -c 500 "$REPORT" >&2 || true
  exit 1
fi

MARKER="$(node - "$REPORT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const all=Array.isArray(p.unmatchedGames)?p.unmatchedGames:[];
if(Number(p.finals)<25) throw new Error(`suspicious Hooten final count ${p.finals}`);
if(all.length!==Number(p.unmatched)) throw new Error('unmatched count mismatch');
const games=all.slice(0,10);
const indexes=games.map(g=>Number(g.index).toString(36).padStart(2,'0')).join('');
let anchorMask=0;
games.forEach((g,i)=>{if(g.reason==='no_recent_game_anchor') anchorMask|=(1<<i);});
const marker=`h${all.length.toString(36)}-${indexes||'none'}-r${anchorMask.toString(16).padStart(3,'0')}`;
if(marker.length>32) throw new Error(`marker too long ${marker}`);
console.log(marker);
NODE
)"

echo "HOOTENS_UNMATCHED_MARKER $MARKER"
node - "$MARKER" > "$WRAPPER" <<'NODE'
const marker=process.argv[2];
process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(marker)},{headers:{"content-type":"text/plain","cache-control":"no-store"}})}};\n`);
NODE
wrangler versions upload "$WRAPPER" --preview-alias "$MARKER" --keep-vars
