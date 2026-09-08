#!/usr/bin/env bash
set -euo pipefail
API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
TOKEN="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));process.stdout.write(String(p.vars.VOLLEYBALL_CONVERGENCE_TOKEN||''))")"
if [ -z "$TOKEN" ]; then
  echo "AUG24_READINESS=NO_STAGED_TOKEN" >&2
  exit 1
fi
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-volleyball-convergence-token: $TOKEN" -H 'cache-control: no-store' "$API/api/v1/internal/volleyball-convergence/ready" || true)"
if [ "$STATUS" != "204" ]; then
  echo "AUG24_READINESS=FAIL HTTP=${STATUS:-curl_error}" >&2
  exit 1
fi
echo "AUG24_READINESS=PASS"
