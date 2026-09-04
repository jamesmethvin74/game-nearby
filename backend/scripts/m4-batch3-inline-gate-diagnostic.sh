#!/usr/bin/env bash
set -euo pipefail

TRIGGER_URL="https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/m4/bootstrap-approved-b3"

# Deploy the inline HEAD-only diagnostic route. No D1 reads or writes.
wrangler deploy

# Fresh runtime-only secret, matching the proven Batch 2 mechanism.
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
printf '%s' "$TOKEN" | wrangler secret put M4_BATCH3_TOKEN

# Authorized readiness only. No POST; this route cannot invoke collection.
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 --head -H "x-m4-batch3-token: $TOKEN" -H 'cache-control: no-store' "$TRIGGER_URL")"
if [ "$STATUS" != "204" ]; then
  echo "Inline Batch 3 gate readiness failed: HTTP $STATUS" >&2
  exit 1
fi

echo "M4_BATCH3_INLINE_GATE_READY"
