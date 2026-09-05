#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
HS_PATH="/api/v1/content/logo-bootstrap/high-school"
ACCOUNT_ID="588568148fa47810445f37081e49562c"
SCRIPT_NAME="localbleachersar-sports-api"
TMPDIR="$(mktemp -d)"
TOKEN=""
SECRET_INSTALLED=0

cleanup() {
  rm -rf "$TMPDIR"
  if [ "$SECRET_INSTALLED" = "1" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    curl -sS --max-time 30 -o /dev/null -X DELETE \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/secrets/LOGO_BOOTSTRAP_TOKEN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

post_hs() {
  local outfile="$1"
  local code
  code="$(curl -sS --max-time 180 -o "$outfile" -w '%{http_code}' -X POST \
    -H 'accept: application/json' \
    -H 'content-type: application/json' \
    -H 'cache-control: no-store' \
    -H "x-logo-bootstrap-token: $TOKEN" \
    --data '{"limit":25}' \
    "$API$HS_PATH")"
  if [ "$code" != "200" ]; then
    echo "HS_LOGO_HTTP_FAILURE code=$code" >&2
    cat "$outfile" >&2 || true
    return 1
  fi
}

parse_hs_response() {
  local infile="$1"
  node - "$infile" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
let p;
try {
  p = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`HS_LOGO_RESPONSE_PARSE_FAILURE path=${path} error=${String(error?.message || error)}`);
  process.exit(2);
}
const status = String(p?.status || '');
const written = Number(p?.written || 0);
const missing = Number(p?.missingBefore || 0);
const candidates = Number(p?.candidates || 0);
const sourceFailures = Array.isArray(p?.sourceFailures) ? p.sourceFailures.length : 0;
const unresolved = Array.isArray(p?.unresolved) ? p.unresolved.length : 0;
const rowsRead = Number(p?.rowsRead || 0);
const rowsWritten = Number(p?.rowsWritten || 0);
if (!['COMPLETE','PARTIAL'].includes(status)) {
  console.error(`HS_LOGO_RESPONSE_BAD_STATUS status=${status} payload=${JSON.stringify(p)}`);
  process.exit(3);
}
if (!Number.isFinite(written) || written < 0 || written > 25) {
  console.error(`HS_LOGO_RESPONSE_BAD_WRITTEN written=${written}`);
  process.exit(4);
}
console.log([status,written,missing,candidates,sourceFailures,unresolved,rowsRead,rowsWritten].join('|'));
NODE
}

npm run check

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Missing authenticated Cloudflare build token" >&2
  exit 1
fi

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
SECRET_BODY="$(node -e 'console.log(JSON.stringify({name:"LOGO_BOOTSTRAP_TOKEN",text:process.argv[1],type:"secret_text"}))' "$TOKEN")"
SECRET_OK=0
for ATTEMPT in 1 2 3; do
  SECRET_OUT="$TMPDIR/secret-put-$ATTEMPT.json"
  SECRET_CODE="$(curl -sS --max-time 30 -o "$SECRET_OUT" -w '%{http_code}' -X PUT \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    --data "$SECRET_BODY" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/secrets" || true)"
  if [ "$SECRET_CODE" = "200" ] && node - "$SECRET_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
process.exit(p?.success===true ? 0 : 1);
NODE
  then
    SECRET_INSTALLED=1
    SECRET_OK=1
    echo "HS_LOGO_SECRET_INSTALLED_NATIVE attempt=$ATTEMPT"
    break
  fi
  echo "HS native secret install attempt $ATTEMPT failed code=${SECRET_CODE:-curl_error}" >&2
  cat "$SECRET_OUT" >&2 || true
  sleep 3
done
if [ "$SECRET_OK" != "1" ]; then
  echo "HS native secret installation failed after bounded retries" >&2
  exit 1
fi

READY_STATUS=""
for ATTEMPT in $(seq 1 20); do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-logo-bootstrap-token: $TOKEN" \
    -H 'cache-control: no-store' \
    "$API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then
    echo "HS_LOGO_READY attempt=$ATTEMPT"
    break
  fi
  echo "HS logo readiness attempt $ATTEMPT returned HTTP ${READY_STATUS:-curl_error}" >&2
  sleep 3
done
if [ "$READY_STATUS" != "204" ]; then
  echo "HS logo readiness never reached 204" >&2
  exit 1
fi

TOTAL_WRITTEN=0
for BATCH in 1 2 3 4 5 6 7 8; do
  OUT="$TMPDIR/high-school-$BATCH.json"
  if ! post_hs "$OUT"; then
    exit 1
  fi
  if ! METRICS="$(parse_hs_response "$OUT")"; then
    echo "HS_LOGO_RESPONSE_FAILURE batch=$BATCH" >&2
    cat "$OUT" >&2 || true
    exit 1
  fi

  STATUS="${METRICS%%|*}"
  REST="${METRICS#*|}"
  WRITTEN="${REST%%|*}"; REST="${REST#*|}"
  MISSING="${REST%%|*}"; REST="${REST#*|}"
  CANDIDATES="${REST%%|*}"; REST="${REST#*|}"
  SOURCE_FAILURES="${REST%%|*}"; REST="${REST#*|}"
  UNRESOLVED="${REST%%|*}"; REST="${REST#*|}"
  ROWS_READ="${REST%%|*}"
  ROWS_WRITTEN="${REST#*|}"

  TOTAL_WRITTEN=$((TOTAL_WRITTEN + WRITTEN))
  echo "HS_LOGO_BATCH batch=$BATCH status=$STATUS missingBefore=$MISSING candidates=$CANDIDATES written=$WRITTEN sourceFailures=$SOURCE_FAILURES unresolved=$UNRESOLVED rowsRead=$ROWS_READ rowsWritten=$ROWS_WRITTEN totalWritten=$TOTAL_WRITTEN"

  if [ "$STATUS" = "COMPLETE" ]; then
    echo "HS_LOGO_COMPLETE totalWritten=$TOTAL_WRITTEN"
    exit 0
  fi
  if [ "$WRITTEN" -eq 0 ]; then
    echo "HS logo completion made no progress; sourceFailures=$SOURCE_FAILURES unresolved=$UNRESOLVED" >&2
    cat "$OUT" >&2 || true
    exit 1
  fi
done

echo "HS logo completion did not reach COMPLETE within eight bounded batches" >&2
exit 1
