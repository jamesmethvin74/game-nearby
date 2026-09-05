#!/usr/bin/env bash
set -u

OUT="$(mktemp)"
RESULT_WRAPPER="src/_hootens-guy-perkins-final-debug.mjs"
cleanup(){ rm -f "$OUT" "$RESULT_WRAPPER"; }
trap cleanup EXIT

set +e
bash scripts/run-approved-hootens-guy-perkins-final.sh >"$OUT" 2>&1
RC=$?
set -e

MARKER="$(node - "$OUT" "$RC" <<'NODE'
const fs=require('fs');
const out=fs.readFileSync(process.argv[2],'utf8');
const rc=Number(process.argv[3]||0);
let marker=`gp-r${rc}`;
let m;
if((m=out.match(/HOOTENS_FINAL_PROOF\s+(\S+)/))) marker=m[1];
else if((m=out.match(/expected exactly one Blevins 12-28 Guy-Perkins Hooten source row; found\s+(\d+)/i))) marker=`gp-src${m[1]}`;
else if((m=out.match(/expected exactly one Guy-Perkins school; found\s+(\d+)/i))) marker=`gp-school${m[1]}`;
else if((m=out.match(/target verification expected one Guy-Perkins 28-12 Blevins row; found\s+(\d+)/i))) marker=`gp-after${m[1]}`;
else if((m=out.match(/Targeted Guy-Perkins repair failed HTTP\s+(\d+)/i))) marker=`gp-http${m[1]}`;
else if((m=out.match(/verify failed\s+(\{.*?\})\s+writes=(\d+)/i))){try{const r=JSON.parse(m[1]);marker=`gp-v-f${Number(r.finals||0)}m${Number(r.matched||0)}u${Number(r.unmatched||0)}-r${Number(r.recovered_found||0)}k${Number(r.present_mask||0)}w${Number(m[2]||0)}`;}catch{marker='gp-verifyfail';}}
else if(/Could not resolve Wrangler Preview Alias URL/i.test(out)) marker='gp-nourl';
else if(/preview never became ready/i.test(out)) marker='gp-notready';
else if(/missing Hooten scoreboard URL/i.test(out)) marker='gp-nofeed';
else if(/SyntaxError|ERR_MODULE|ERR_ASSERTION|npm ERR!/i.test(out)) marker='gp-codeerr';
marker=String(marker).toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,32)||'gp-unknown';
console.log(marker);
NODE
)"

node - "$OUT" "$RC" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs');
const out=fs.readFileSync(process.argv[2],'utf8');
const rc=Number(process.argv[3]||0);
process.stdout.write(`const RESULT=${JSON.stringify({rc,tail:out.slice(-16000)})};\nexport default {async fetch(){return Response.json(RESULT,{headers:{"cache-control":"no-store"}})}};\n`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$MARKER" --keep-vars >/dev/null 2>&1 || true
cat "$OUT"
echo "HOOTENS_GUY_PERKINS_FINAL_DEBUG $MARKER"
exit 0
