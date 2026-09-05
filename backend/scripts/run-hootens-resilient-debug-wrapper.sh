#!/usr/bin/env bash
set -u

OUT="$(mktemp)"
WRAPPER="src/_hootens-resilient-debug-result.mjs"
cleanup(){ rm -f "$OUT" "$WRAPPER"; }
trap cleanup EXIT

set +e
bash scripts/run-approved-hootens-resilient-catchup.sh >"$OUT" 2>&1
RC=$?
set -e

DEBUG_ALIAS="$(node - "$OUT" "$RC" <<'NODE'
const fs=require('fs');
const out=fs.readFileSync(process.argv[2],'utf8');
const rc=Number(process.argv[3]||0);
let marker=`hd-r${rc}`;
const lines=out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
let result=null;
for(let i=lines.length-1;i>=0;i--){
  if(!lines[i].startsWith('{')) continue;
  try{
    const value=JSON.parse(lines[i]);
    if(value && (value.finals!=null || value.matched!=null || value.unmatched!=null || value.resilientStatus || value.status)) { result=value; break; }
  }catch{}
}
if(result){
  const f=Number(result.finals||0),m=Number(result.matched||0),u=Number(result.unmatched||0);
  const b=Number(result.resilientMissingBefore??-1),p=Number(result.resilientRepaired??-1);
  marker=`hd-f${f}m${m}u${u}-b${b}p${p}`;
  if(result.resilientStatus==='FAILURE') marker=`hd-rsfail-f${f}m${m}u${u}`;
}else{
  let x;
  if((x=out.match(/exceeds bounded repair limit\s+(\d+)/i))) marker=`hd-cap${x[1]}`;
  else if((x=out.match(/parser returned suspicious final count\s+(\d+)/i))) marker=`hd-parse${x[1]}`;
  else if((x=out.match(/run incomplete:\s*(\d+)\/(\d+)\/(\d+)/i))) marker=`hd-f${x[1]}m${x[2]}u${x[3]}`;
  else if((x=out.match(/catch-up failed HTTP\s+(\d+)/i))) marker=`hd-http${x[1]}`;
  else if(/preview never became ready/i.test(out)) marker='hd-notready';
  else if(/SyntaxError|ERR_MODULE|ERR_ASSERTION/i.test(out)) marker='hd-codeerr';
  else if(/verify failed/i.test(out)) marker='hd-verifyfail';
}
marker=marker.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,32);
console.log(marker||'hd-unknown');
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
echo "HOOTENS_DEBUG_MARKER $DEBUG_ALIAS"
exit 0
