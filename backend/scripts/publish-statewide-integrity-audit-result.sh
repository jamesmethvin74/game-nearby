#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ALIAS="statewide-integrity-audit-result"
WORKER="localbleachersar-sports-api"
API_FALLBACK="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
API=""
SEASON="${AUDIT_SEASON:-2026}"
SAMPLE_LIMIT="${AUDIT_SAMPLE_LIMIT:-1000}"
EXEC_WRAPPER="src/_statewide-integrity-audit-exec.mjs"
RESULT_WRAPPER="src/_statewide-integrity-audit-result.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"

cleanup() {
  rm -f "$EXEC_WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT INT TERM

if ! grep -q '"database_name": "localbleachersar-sports"' wrangler.jsonc; then
  echo "Refusing audit: wrangler.jsonc is not bound to localbleachersar-sports" >&2
  exit 2
fi

if ! [[ "$SAMPLE_LIMIT" =~ ^[0-9]+$ ]] || [ "$SAMPLE_LIMIT" -lt 1 ]; then
  echo "AUDIT_SAMPLE_LIMIT must be a positive integer" >&2
  exit 2
fi

node - "$TOKEN" "$SEASON" "$SAMPLE_LIMIT" > "$EXEC_WRAPPER" <<'NODE'
const [token, season, sampleLimitRaw] = process.argv.slice(2);
const sampleLimit = Number(sampleLimitRaw);
process.stdout.write(`
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
const TOKEN=${JSON.stringify(token)};
const SEASON=${JSON.stringify(season)};
const SAMPLE_LIMIT=${JSON.stringify(sampleLimit)};
function authorized(request){return request.headers.get("x-statewide-audit-token")===TOKEN;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==="HEAD"&&url.pathname==="/ready"){
      return authorized(request)?new Response(null,{status:204,headers:{"cache-control":"no-store"}}):json({error:"not_found"},404);
    }
    if(request.method==="GET"&&url.pathname==="/run"){
      if(!authorized(request)) return json({error:"not_found"},404);
      const result=await buildStatewideDataIntegrityAudit(env,{season:SEASON,sampleLimit:SAMPLE_LIMIT});
      return json(result);
    }
    return json({error:"not_found"},404);
  }
};
`);
NODE

UPLOAD_LOG="$TMPDIR/exec-upload.log"
wrangler versions upload "$EXEC_WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_LOG"

API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD_LOG" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
if [ -z "$API" ]; then
  API="$API_FALLBACK"
fi
echo "STATEWIDE_AUDIT_PREVIEW_URL=$API"

READY=""
for ATTEMPT in $(seq 1 40); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head     -H "x-statewide-audit-token: $TOKEN" -H 'cache-control: no-store'     "$API/ready" || true)"
  if [ "$READY" = "204" ]; then
    break
  fi
  sleep 3
done
if [ "$READY" != "204" ]; then
  echo "Statewide audit preview never became ready: url=$API last_http=$READY" >&2
  exit 1
fi

OUT="$TMPDIR/audit.json"
HTTP_STATUS="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}'   -H "x-statewide-audit-token: $TOKEN" -H 'accept: application/json' -H 'cache-control: no-store'   "$API/run")"
if [ "$HTTP_STATUS" != "200" ]; then
  echo "Statewide integrity audit failed: HTTP $HTTP_STATUS" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const written=Number(p?.d1?.rows_written ?? p?.d1?.rowsWritten ?? 0);
if(written!==0) throw new Error(`Read-only audit reported rows_written=${written}`);
if(!p?.audit_version) throw new Error('Audit result missing audit_version');
NODE

node - "$OUT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs');
const body=fs.readFileSync(process.argv[2],'utf8');
process.stdout.write(`
const BODY=${JSON.stringify(body)};
export default {
  async fetch(){
    return new Response(BODY,{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  }
};
`);
NODE

# Replace the token-gated execution preview with a read-only result preview.
RESULT_UPLOAD_LOG="$TMPDIR/result-upload.log"
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$RESULT_UPLOAD_LOG"

echo "STATEWIDE_INTEGRITY_AUDIT_PUBLISHED url=$API season=$SEASON sampleLimit=$SAMPLE_LIMIT"
