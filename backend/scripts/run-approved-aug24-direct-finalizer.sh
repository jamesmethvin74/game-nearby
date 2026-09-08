#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
RUN_PATH="/api/v1/internal/volleyball-aug24-finalize"
STATUS_PATH="/api/v1/internal/volleyball-aug24-finalize/status"
TOKEN="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));process.stdout.write(String(p.vars.VOLLEYBALL_CONVERGENCE_TOKEN||''))")"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

if [ -z "$TOKEN" ]; then
  echo "Missing staged volleyball convergence token" >&2
  exit 1
fi

RUN_OUT="$TMPDIR/run.json"
RUN_CODE="$(curl -sS --max-time 180 -o "$RUN_OUT" -w '%{http_code}' -X POST \
  -H 'accept: application/json' \
  -H 'cache-control: no-store' \
  -H "x-volleyball-convergence-token: $TOKEN" \
  "$API$RUN_PATH" || true)"

echo "AUG24_FINALIZER_POST_HTTP=$RUN_CODE"
cat "$RUN_OUT" || true

# Always verify persisted state, even if the POST returned an error after partial work.
STATUS_OUT="$TMPDIR/status.json"
STATUS_CODE="$(curl -sS --max-time 60 -o "$STATUS_OUT" -w '%{http_code}' \
  -H 'accept: application/json' \
  -H 'cache-control: no-store' \
  -H "x-volleyball-convergence-token: $TOKEN" \
  "$API$STATUS_PATH" || true)"

echo "AUG24_FINALIZER_STATUS_HTTP=$STATUS_CODE"
cat "$STATUS_OUT" || true

if [ "$STATUS_CODE" != "200" ]; then
  echo "Exact Aug 24 finalizer did not reach verified production state" >&2
  exit 1
fi

node - "$STATUS_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(p.status!=="PASS") throw new Error(`Finalizer status ${p.status||'missing'}`);
if(Number(p.auditRunId)!==34172135818) throw new Error('Wrong audit provenance');
if(Number(p.finals)!==3) throw new Error(`Expected 3 verified finals, got ${p.finals}`);
const rows=Array.isArray(p.rows)?p.rows:[];
if(rows.length<3) throw new Error(`Expected at least 3 verification rows, got ${rows.length}`);
console.log('AUG24_DIRECT_FINALIZER_VERIFIED');
NODE
