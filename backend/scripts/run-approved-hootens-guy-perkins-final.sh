#!/usr/bin/env bash
set -euo pipefail

PATCHED="$(mktemp)"
cleanup(){ rm -f "$PATCHED"; }
trap cleanup EXIT

python3 - scripts/run-approved-hootens-guy-perkins-finish.sh "$PATCHED" <<'PY'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text()
old_upload = '''wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=1'''
new_upload = '''UPLOAD_OUT="$TMPDIR/preview-upload.txt"
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_OUT"
API="$(grep -Eo 'https://[^[:space:]]+\\.workers\\.dev' "$UPLOAD_OUT" | tail -n 1 | tr -d '\\r')"
if [ -z "$API" ]; then
  echo "Could not resolve Wrangler Preview Alias URL" >&2
  exit 1
fi
echo "Using Wrangler preview URL: $API"
TOKEN_ACTIVE=1'''
old_ready_break = 'if [ "$READY" = "204" ]; then break; fi'
new_ready_break = 'if [ "$READY" = "200" ] || [ "$READY" = "204" ]; then break; fi'
old_ready_fail = 'if [ "$READY" != "204" ]; then'
new_ready_fail = 'if [ "$READY" != "200" ] && [ "$READY" != "204" ]; then'
old_run_handler = 'if(request.method==="POST"&&path==="/run"){try{return json(await repair(env));}'
new_run_handler = 'if(request.method==="GET"&&path==="/run"){try{return json(await repair(env));}'
old_run_method = '-X POST -H "x-hootens-target-token: $TOKEN"'
new_run_method = '-X GET -H "x-hootens-target-token: $TOKEN"'
for old in (old_upload, old_ready_break, old_ready_fail, old_run_handler, old_run_method):
    if old not in src:
        raise SystemExit(f'expected activation block not found: {old}')
src = src.replace(old_upload, new_upload, 1)
src = src.replace(old_ready_break, new_ready_break, 1)
src = src.replace(old_ready_fail, new_ready_fail, 1)
src = src.replace(old_run_handler, new_run_handler, 1)
src = src.replace(old_run_method, new_run_method, 1)
Path(sys.argv[2]).write_text(src)
PY

chmod +x "$PATCHED"
exec bash "$PATCHED"
