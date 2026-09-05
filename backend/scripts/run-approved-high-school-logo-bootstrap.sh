#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
HS_PATH="/api/v1/content/logo-bootstrap/high-school"
TMPDIR="$(mktemp -d)"
TOKEN=""
SECRET_INSTALLED=0

cleanup() {
  rm -rf "$TMPDIR"
  if [ "$SECRET_INSTALLED" = "1" ]; then
    wrangler secret delete LOGO_BOOTSTRAP_TOKEN --yes >/dev/null 2>&1 || true
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
    exit 1
  fi
}

npm run check
wrangler deploy

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
printf '%s' "$TOKEN" | wrangler secret put LOGO_BOOTSTRAP_TOKEN
SECRET_INSTALLED=1

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
  post_hs "$OUT"
  read -r STATUS WRITTEN MISSING CANDIDATES SOURCE_FAILURES UNRESOLVED ROWS_READ ROWS_WRITTEN <<<"$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const vals=[
  p.status||'', Number(p.written||0), Number(p.missingBefore||0), Number(p.candidates||0),
  Array.isArray(p.sourceFailures)?p.sourceFailures.length:0,
  Array.isArray(p.unresolved)?p.unresolved.length:0,
  Number(p.rowsRead||0), Number(p.rowsWritten||0)
];
console.log(vals.join(' '));
NODE
)"

  if [ "$WRITTEN" -lt 0 ] || [ "$WRITTEN" -gt 25 ]; then
    echo "HS logo batch exceeded cap: $WRITTEN" >&2
    exit 1
  fi
  TOTAL_WRITTEN=$((TOTAL_WRITTEN + WRITTEN))
  echo "HS_LOGO_BATCH batch=$BATCH status=$STATUS missingBefore=$MISSING candidates=$CANDIDATES written=$WRITTEN sourceFailures=$SOURCE_FAILURES unresolved=$UNRESOLVED rowsRead=$ROWS_READ rowsWritten=$ROWS_WRITTEN totalWritten=$TOTAL_WRITTEN"

  if [ "$STATUS" = "COMPLETE" ]; then
    echo "HS_LOGO_COMPLETE totalWritten=$TOTAL_WRITTEN"
    exit 0
  fi
  if [ "$STATUS" != "PARTIAL" ]; then
    echo "Unexpected HS logo status: $STATUS" >&2
    cat "$OUT" >&2 || true
    exit 1
  fi
  if [ "$WRITTEN" -eq 0 ]; then
    echo "HS logo completion made no progress; sourceFailures=$SOURCE_FAILURES unresolved=$UNRESOLVED" >&2
    cat "$OUT" >&2 || true
    exit 1
  fi
done

echo "HS logo completion did not reach COMPLETE within eight bounded batches" >&2
exit 1
