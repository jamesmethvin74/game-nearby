#!/usr/bin/env bash
set -u

OUT="$(mktemp)"
WRAPPER="src/_hootens-resilient-debug-result.mjs"
DEBUG_ALIAS="hootens-resilient-debug"
cleanup(){ rm -f "$OUT" "$WRAPPER"; }
trap cleanup EXIT

set +e
bash scripts/run-approved-hootens-resilient-catchup.sh >"$OUT" 2>&1
RC=$?
set -e

node - "$OUT" "$RC" > "$WRAPPER" <<'NODE'
const fs=require('fs');
const out=fs.readFileSync(process.argv[2],'utf8');
const rc=Number(process.argv[3]||0);
const tail=out.slice(-16000);
process.stdout.write(`const RESULT=${JSON.stringify({rc,tail})};\nexport default {async fetch(){return Response.json(RESULT,{headers:{"cache-control":"no-store"}})}};\n`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$DEBUG_ALIAS" --keep-vars >/dev/null 2>&1 || true
cat "$OUT"
exit 0
