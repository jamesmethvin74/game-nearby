#!/usr/bin/env bash
set -euo pipefail

REPORT_URL='https://college-logo-app-audit-localbleachersar-sports-api.james-methvin74.workers.dev'
ROOT="$(git rev-parse --show-toplevel)"
OUT="$ROOT/backend/audits/college-logo-app-audit-production.json"
mkdir -p "$(dirname "$OUT")"

curl -fsS --max-time 45 "$REPORT_URL" -o "$OUT"

COMPACT="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(Number(p?.counts?.total)!==36) throw new Error(`expected 36 colleges, got ${p?.counts?.total}`);
const failures=Array.isArray(p.failures)?p.failures:[];
const compact=failures.map(x=>String(x.schoolId||'').replace(/^asu-/,'a-').replace(/-/g,'')).join('-').slice(0,36) || 'none';
console.log(`${Number(p?.counts?.appFallback||0)}-${compact}`);
NODE
)"

echo "COLLEGE_LOGO_AUDIT_EXPORTED $COMPACT"

# Best effort: publish the exact immutable audit JSON back to a non-deploy branch.
# Cloudflare's GitHub checkout may or may not expose push credentials; failure here
# is non-fatal because the compact failure marker is still published below.
(
  cd "$ROOT"
  git config user.name 'LocalBleachersAR Cloudflare Audit'
  git config user.email 'audit@localbleachersar.invalid'
  git checkout -B ops/college-logo-audit-result
  git add backend/audits/college-logo-app-audit-production.json
  git commit -m 'Capture production college logo app audit' || true
  git push --force origin HEAD:refs/heads/ops/college-logo-audit-result
) || echo 'AUDIT_REPORT_GIT_PUSH_UNAVAILABLE'

# Always publish a compact failure marker into the Cloudflare check summary via
# the preview alias, even if GitHub push credentials are not available.
SAFE_ALIAS="college-audit-${COMPACT}"
SAFE_ALIAS="${SAFE_ALIAS:0:60}"
node --input-type=module - "$OUT" <<'NODE'
import fs from 'node:fs';
const body=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync('src/college-logo-audit-export-worker.js', `const BODY=${JSON.stringify(body)};export default{async fetch(){return new Response(BODY,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}};`);
NODE
wrangler versions upload src/college-logo-audit-export-worker.js --preview-alias "$SAFE_ALIAS" --keep-vars
