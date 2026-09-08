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
if(p.status!=="PASS") throw new Error(p.message||"Aug 24 convergence preflight failed");
if(p.tokenConfigured!==true) throw new Error("Convergence token is not configured");
if(Number(p.preflight?.targetTeams)!==3) throw new Error("Unexpected target-team count");
if(Number(p.source?.approvedContests)!==3) throw new Error("Approved MaxPreps contest set incomplete");
console.log("AUG24_PREFLIGHT_PASS");
NODE
