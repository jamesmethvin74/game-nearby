#!/usr/bin/env bash
set -euo pipefail

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
printf '%s' "$TOKEN" | wrangler secret put M4_BATCH3_TOKEN

echo "M4_BATCH3_SECRET_INSTALLED"
