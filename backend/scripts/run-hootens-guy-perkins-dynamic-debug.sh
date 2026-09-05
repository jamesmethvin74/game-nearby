#!/usr/bin/env bash
set -u

PATCHED="$(mktemp)"
OUT="$(mktemp)"
RESULT_WRAPPER="src/_hootens-guy-perkins-dynamic-debug.mjs"
cleanup(){ rm -f "$PATCHED" "$OUT" "$RESULT_WRAPPER"; }
trap cleanup EXIT

python3 - scripts/run-approved-hootens-guy-perkins-finish.sh "$PATCHED" <<'PY'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text()
old = '''wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=1'''
new = '''UPLOAD_OUT="$TMPDIR/preview-upload.txt"
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_OUT"
API="$(grep -Eo 'https://[^[:space:]]+\\.workers\\.dev' "$UPLOAD_OUT" | tail -n 1 | tr -d '\\r')"
if [ -z "$API" ]; then
  echo "Could not resolve Wrangler Preview Alias URL" >&2
  exit 1
fi
echo "Using Wrangler preview URL: $API"
TOKEN_ACTIVE=1'''
if old not in src:
    raise SystemExit('preview upload block not found')
Path(sys.argv[2]).write_text(src.replace(old, new, 1))
PY
chmod +x "$PATCHED"

set +e
bash "$PATCHED" >"$OUT" 2>&1
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
else if((m=out.match(/verify failed\s+(\{.*?\})\s+writes=(\d+)/i))){try{const r=JSON.parse(m[1]);marker=`gp-v-f${Number(r.finals||0)}m${Number(r.matched||0)}u${Number(r.unmatched||0)}-r${Number(r.recovered_found||0)}k${Number(r.present_mask||0)}`;}catch{marker='gp-verifyfail';}}
else if((m=out.match(/Targeted Guy-Perkins repair failed HTTP\s+(\d+)/i))) marker=`gp-http${m[1]}`;
else if(/Could not resolve Wrangler Preview Alias URL/i.test(out)) marker='gp-nourl';
else if(/preview never became ready/i.test(out)) marker='gp-notready';
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
echo "HOOTENS_GUY_PERKINS_DYNAMIC_DEBUG $MARKER"
exit 0
