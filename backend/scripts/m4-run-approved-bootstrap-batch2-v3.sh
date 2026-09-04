#!/usr/bin/env bash
set -euo pipefail

TRIGGER_URL="https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/m4/bootstrap-approved-b2"
BEFORE_JSON="/tmp/m4-batch2-v3-before.json"
PAYLOAD_JSON="/tmp/m4-batch2-v3-payload.json"
AFTER_JSON="/tmp/m4-batch2-v3-after.json"

STATE_SQL="SELECT COUNT(DISTINCT g.source_id) AS populated_sources, COUNT(*) AS game_rows FROM games g JOIN sources src ON src.id=g.source_id JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id WHERE sch.level='college' AND sch.catalog_scope='local' AND t.season='2026'"

rm -f "$BEFORE_JSON" "$PAYLOAD_JSON" "$AFTER_JSON"

# One bounded pre-state read, using Wrangler directly in the Cloudflare shell.
wrangler d1 execute localbleachersar-sports --remote --command="$STATE_SQL" --json > "$BEFORE_JSON"

# Deploy the temporary token-protected Batch 2 route.
wrangler deploy

# Generate a runtime-only token and install it as a Worker secret.
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
printf '%s' "$TOKEN" | wrangler secret put M4_BATCH2_TOKEN

# Non-mutating readiness proof before the one allowed POST.
READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 --head -H "x-m4-batch2-token: $TOKEN" -H 'cache-control: no-store' "$TRIGGER_URL")"
if [ "$READY_STATUS" != "204" ]; then
  echo "Batch 2 readiness failed: HTTP $READY_STATUS" >&2
  exit 1
fi

# Exactly one Batch 2 POST. The existing collector selector remains capped at 8 sources.
POST_STATUS="$(curl -sS -o "$PAYLOAD_JSON" -w '%{http_code}' --max-time 180 -X POST -H 'accept: application/json' -H 'cache-control: no-store' -H "x-m4-batch2-token: $TOKEN" "$TRIGGER_URL")"
if [ "$POST_STATUS" != "200" ]; then
  echo "Batch 2 POST failed: HTTP $POST_STATUS" >&2
  cat "$PAYLOAD_JSON" >&2 || true
  exit 1
fi

# One bounded post-state read, again using Wrangler directly.
wrangler d1 execute localbleachersar-sports --remote --command="$STATE_SQL" --json > "$AFTER_JSON"

# Offline assertions only; this verifier performs no network or D1 operations.
node scripts/m4-verify-approved-bootstrap-batch2-v3.js "$BEFORE_JSON" "$PAYLOAD_JSON" "$AFTER_JSON"
