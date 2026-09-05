#!/usr/bin/env bash
set -euo pipefail

PREVIEW_ALIAS="hs-logo-repair"
API="https://${PREVIEW_ALIAS}-localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
HS_PATH="/api/v1/content/logo-bootstrap/high-school"
WRAPPER="src/_hs-logo-repair-exec.mjs"
TMPDIR="$(mktemp -d)"
TOKEN=""
TOKEN_ACTIVE=0

cleanup() {
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$PREVIEW_ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import app from "./logo-bootstrap-worker.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction withToken(env){const wrapped=Object.create(env);Object.defineProperty(wrapped,"LOGO_BOOTSTRAP_TOKEN",{value:TOKEN,enumerable:true});return wrapped;}\nexport default {fetch(request,env,ctx){return app.fetch(request,withToken(env),ctx);}};\n`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$PREVIEW_ALIAS" --keep-vars
TOKEN_ACTIVE=1

READY_STATUS=""
for ATTEMPT in $(seq 1 20); do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-logo-bootstrap-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then
    echo "HS_LOGO_REPAIR_READY attempt=$ATTEMPT"
    break
  fi
  sleep 3
done
if [ "$READY_STATUS" != "204" ]; then
  echo "HS logo repair readiness never reached 204" >&2
  exit 1
fi

TOTAL_WRITTEN=0
UNRESOLVED_COUNT=-1
TERMINAL=0
for BATCH in 1 2 3 4; do
  OUT="$TMPDIR/hs-$BATCH.json"
  CODE="$(curl -sS --max-time 180 -o "$OUT" -w '%{http_code}' -X POST \
    -H 'accept: application/json' -H 'content-type: application/json' -H 'cache-control: no-store' \
    -H "x-logo-bootstrap-token: $TOKEN" --data '{"limit":25}' "$API$HS_PATH")"
  if [ "$CODE" != "200" ]; then
    echo "HS_LOGO_REPAIR_HTTP_FAILURE code=$CODE" >&2
    cat "$OUT" >&2 || true
    exit 1
  fi
  METRICS="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const status=String(p.status||'');
const written=Number(p.written||0);
const unresolved=Array.isArray(p.unresolved)?p.unresolved.length:0;
const failures=Array.isArray(p.sourceFailures)?p.sourceFailures.length:0;
if(!['COMPLETE','PARTIAL'].includes(status)) throw new Error(`Unexpected status ${status}`);
if(!Number.isFinite(written)||written<0||written>25) throw new Error(`Write cap violation ${written}`);
console.log([status,written,Number(p.missingBefore||0),Number(p.candidates||0),unresolved,failures].join('|'));
NODE
)"
  STATUS="${METRICS%%|*}"; REST="${METRICS#*|}"
  WRITTEN="${REST%%|*}"; REST="${REST#*|}"
  MISSING_BEFORE="${REST%%|*}"; REST="${REST#*|}"
  CANDIDATES="${REST%%|*}"; REST="${REST#*|}"
  UNRESOLVED="${REST%%|*}"; FAILURES="${REST#*|}"
  TOTAL_WRITTEN=$((TOTAL_WRITTEN + WRITTEN))
  echo "HS_LOGO_REPAIR_BATCH batch=$BATCH status=$STATUS missingBefore=$MISSING_BEFORE candidates=$CANDIDATES written=$WRITTEN unresolved=$UNRESOLVED sourceFailures=$FAILURES totalWritten=$TOTAL_WRITTEN"
  if [ "$STATUS" = "COMPLETE" ]; then
    UNRESOLVED_COUNT=0
    TERMINAL=1
    break
  fi
  if [ "$WRITTEN" -eq 0 ]; then
    UNRESOLVED_COUNT="$UNRESOLVED"
    TERMINAL=1
    break
  fi
done

if [ "$TERMINAL" != "1" ]; then
  echo "HS logo repair exhausted bounded attempts without terminal state" >&2
  exit 1
fi
if [ "$UNRESOLVED_COUNT" -ne 49 ]; then
  echo "HS logo repair expected 49 source-limited schools after broader-directory pass; got $UNRESOLVED_COUNT" >&2
  exit 1
fi

# Remove the temporary execution credential from the active preview alias.
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$PREVIEW_ALIAS" --keep-vars
TOKEN_ACTIVE=0

# Publish only the terminal unresolved count in a clean preview alias so the
# Cloudflare check summary proves the bounded repair result without a D1 read.
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "hsr-${UNRESOLVED_COUNT}" --keep-vars

echo "HS_LOGO_BROADER_REPAIR_COMPLETE totalWritten=$TOTAL_WRITTEN unresolved=$UNRESOLVED_COUNT"
