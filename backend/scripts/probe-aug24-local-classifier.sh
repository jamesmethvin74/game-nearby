#!/usr/bin/env bash
set -euo pipefail
API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
curl -fsS --max-time 60 -H 'cache-control: no-store' "$API/api/v1/internal/volleyball-convergence/diagnostic" -o "$OUT"
cat "$OUT"
node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(p.status==="PASS") throw new Error("Unexpected PASS; previous preflight already failed");
const message=String(p.message||"");
const localFailure=/target-team preflight failed|local identity changed|opponent is now local/.test(message);
if(!localFailure) throw new Error(`Not a local-catalog failure: ${message}`);
console.log("AUG24_PREFLIGHT_BLOCKER=LOCAL_CATALOG");
NODE
