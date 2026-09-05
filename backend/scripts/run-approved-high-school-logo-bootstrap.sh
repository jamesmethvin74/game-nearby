#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
HS_PATH="/api/v1/content/logo-bootstrap/high-school"
TMPDIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

if [ -z "${REFRESH_TOKEN:-}" ]; then
  echo "HS_REFRESH_TOKEN_MISSING" >&2
  exit 1
fi

post_hs() {
  local outfile="$1"
  local code
  code="$(curl -sS --max-time 180 -o "$outfile" -w '%{http_code}' -X POST \
    -H 'accept: application/json' \
    -H 'content-type: application/json' \
    -H 'cache-control: no-store' \
    -H "x-refresh-token: $REFRESH_TOKEN" \
    --data '{"limit":25}' \
    "$API$HS_PATH")"
  if [ "$code" != "200" ]; then
    echo "HS_REFRESH_AUTH_HTTP_FAILURE code=$code" >&2
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
