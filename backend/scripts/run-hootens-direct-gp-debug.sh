#!/usr/bin/env bash
set -u
OUT="$(mktemp)"
WRAPPER="src/_hootens-direct-gp-debug.mjs"
cleanup(){ rm -f "$OUT" "$WRAPPER"; }
trap cleanup EXIT
set +e
bash scripts/run-hootens-direct-gp-finish.sh >"$OUT" 2>&1
RC=$?
set -e
MARKER="$(node - "$OUT" "$RC" <<'NODE'
const fs=require('fs');const out=fs.readFileSync(process.argv[2],'utf8');const rc=Number(process.argv[3]||0);
const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,23);
let marker=`gp-direct-r${rc}`; let m;
if((m=out.match(/HOOTENS_FINAL_PROOF\s+(\S+)/))) marker=m[1];
else if((m=out.match(/HOOTENS_DIRECT_VERIFY_FAILED\s+(\{[^\n]+\})/))){try{const r=JSON.parse(m[1]);marker=`gp-v-f${r.finals||0}m${r.matched||0}u${r.unmatched||0}-r${r.found||0}k${r.mask||0}`;}catch{marker='gp-v-badjson';}}
else if((m=out.match(/Refusing unexpected Guy-Perkins game write count:\s*(\d+)/i))) marker=`gp-writes${m[1]}`;
else if((m=out.match(/D1_ERROR:\s*([^\n\r]+)/i))) marker=`gp-d1-${slug(m[1])}`;
else if((m=out.match(/NOT NULL constraint failed:\s*([^\n\r]+)/i))) marker=`gp-null-${slug(m[1])}`;
else if((m=out.match(/FOREIGN KEY constraint failed/i))) marker='gp-fk';
else if((m=out.match(/UNIQUE constraint failed:\s*([^\n\r]+)/i))) marker=`gp-uniq-${slug(m[1])}`;
else if((m=out.match(/Error:\s*([^\n\r]+)/i))) marker=`gp-err-${slug(m[1])}`;
marker=marker.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,32)||'gp-direct-unknown';console.log(marker);
NODE
)"
node - "$OUT" "$RC" > "$WRAPPER" <<'NODE'
const fs=require('fs');const out=fs.readFileSync(process.argv[2],'utf8');const rc=Number(process.argv[3]||0);process.stdout.write(`const RESULT=${JSON.stringify({rc,tail:out.slice(-16000)})};\nexport default {async fetch(){return Response.json(RESULT)}};\n`);
NODE
wrangler versions upload "$WRAPPER" --preview-alias "$MARKER" --keep-vars >/dev/null 2>&1 || true
cat "$OUT"
echo "HOOTENS_DIRECT_DEBUG $MARKER"
exit 0
