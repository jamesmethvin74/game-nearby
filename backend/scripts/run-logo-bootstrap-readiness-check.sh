#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
TOKEN=""
SECRET_INSTALLED=0

cleanup() {
  if [ "$SECRET_INSTALLED" = "1" ]; then
    wrangler secret delete LOGO_BOOTSTRAP_TOKEN --yes >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

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
    echo "LOGO_BOOTSTRAP_READY attempt=$ATTEMPT"
    exit 0
  fi
  echo "Logo bootstrap readiness attempt $ATTEMPT returned HTTP ${READY_STATUS:-curl_error}" >&2
  sleep 3
done

echo "Logo bootstrap readiness never reached 204; last status=${READY_STATUS:-curl_error}" >&2
exit 1
