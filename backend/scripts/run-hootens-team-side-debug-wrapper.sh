#!/usr/bin/env bash
set -u

OUT="$(mktemp)"
WRAPPER="src/_hootens-team-side-debug-result.mjs"
cleanup(){ rm -f "$OUT" "$WRAPPER"; }
trap cleanup EXIT

set +e
bash scripts/run-approved-hootens-team-side-catchup.sh >"$OUT" 2>&1
RC=$?
set -e

DEBUG_ALIAS="$(node - "$OUT" "$RC" <<'NODE'
const fs=require('fs');
const out=fs.readFileSync(process.argv[2],'utf8');
const rc=Number(process.argv[3]||0);
let marker=`ts-r${rc}`;
let x;
const lines=out.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
let result=null;
for(let i=lines.length-1;i>=0;i--){
  if(!lines[i].startsWith('{')) continue;
  try{
    const v=JSON.parse(lines[i]);
    if(v && (v.teamSideCandidates!=null || v.finals!=null || v.teamSideStatus)){result=v;break;}
  }catch{}
}
if((x=out.match(/team-side completion found\s+(\d+)\s+missing reciprocal rows/i))) marker=`ts-cap${x[1]}`;
else if(result){
  const f=Number(result.finals||0),m=Number(result.matched||0),u=Number(result.unmatched||0);
  const c=Number(result.teamSideCandidates??-1),p=Number(result.teamSidesCreated??-1),s=Number(result.teamSideUnresolved??-1);
  marker=`ts-f${f}m${m}u${u}-c${c}p${p}s${s}`;
  if(result.teamSideStatus==='FAILURE') marker=`ts-sidefail-f${f}m${m}u${u}`;
}else if((x=out.match(/verify failed\s+(\{.*?\})\s+writes=(\d+)/i))){
  try{const r=JSON.parse(x[1]);marker=`ts-v-r${Number(r.recovered_found||0)}k${Number(r.present_mask||0)}`;}catch{marker='ts-verifyfail';}
}else if((x=out.match(/catch-up failed HTTP\s+(\d+)/i))) marker=`ts-http${x[1]}`;
else if(/preview never became ready/i.test(out)) marker='ts-notready';
else if(/SyntaxError|ERR_MODULE|ERR_ASSERTION/i.test(out)) marker='ts-codeerr';
marker=marker.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,32);
console.log(marker||'ts-unknown');
NODE
)"

node - "$OUT" "$RC" > "$WRAPPER" <<'NODE'
const fs=require('fs');
const out=fs.readFileSync(process.argv[2],'utf8');
const rc=Number(process.argv[3]||0);
const tail=out.slice(-16000);
process.stdout.write(`const RESULT=${JSON.stringify({rc,tail})};\nexport default {async fetch(){return Response.json(RESULT,{headers:{"cache-control":"no-store"}})}};\n`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$DEBUG_ALIAS" --keep-vars >/dev/null 2>&1 || true
cat "$OUT"
echo "HOOTENS_TEAM_SIDE_DEBUG $DEBUG_ALIAS"
exit 0
