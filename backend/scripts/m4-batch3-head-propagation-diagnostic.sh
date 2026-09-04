#!/usr/bin/env bash
set -euo pipefail

TRIGGER_URL="https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/m4/bootstrap-approved-b3"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"

# Install a fresh token. This may publish a new Worker version.
printf '%s' "$TOKEN" | wrangler secret put M4_BATCH3_TOKEN

# Allow for bounded propagation of the new secret-bearing version.
STATUS=""
for ATTEMPT in 1 2 3 4 5 6 7 8; do
  STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-m4-batch3-token: $TOKEN" \
    -H 'cache-control: no-store' \
    "$TRIGGER_URL" || true)"
  if [ "$STATUS" = "204" ]; then
    echo "M4_BATCH3_HEAD_READY attempt=$ATTEMPT"
    exit 0
  fi
  echo "Batch 3 readiness attempt $ATTEMPT returned HTTP ${STATUS:-curl_error}" >&2
  sleep 3
done

echo "Batch 3 readiness never reached 204; last status=${STATUS:-curl_error}" >&2
exit 1
