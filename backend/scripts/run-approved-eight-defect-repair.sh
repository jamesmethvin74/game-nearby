#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ALIAS="bounded-eight-defect-repair-result"
WORKER="localbleachersar-sports-api"
API_FALLBACK="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
API=""
READY_PATH="/api/bounded-eight-defect-repair-ready"
RUN_PATH="/api/bounded-eight-defect-repair-run"
RESULT_PATH="/api/bounded-eight-defect-repair-result"
EXEC_WRAPPER="src/_bounded-eight-defect-repair-exec.mjs"
RESULT_WRAPPER="src/_bounded-eight-defect-repair-result.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"

cleanup() {
  rm -f "$EXEC_WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT INT TERM

if ! grep -q '"database_name": "localbleachersar-sports"' wrangler.jsonc; then
  echo "Refusing repair: wrangler.jsonc is not bound to localbleachersar-sports" >&2
  exit 2
fi

node - "$TOKEN" > "$EXEC_WRAPPER" <<'NODE'
const token=process.argv[2];
const targets=[
  ["arkansas-tech-volleyball-women-2026","college-arkansas-tech-volleyball-women-2026-sidearm:native:7556"],
  ["ecclesia-soccer-men-2026","college-ecclesia-soccer-men-2026-sidearm:native:1087"],
  ["john-brown-volleyball-women-2026","college-john-brown-volleyball-women-2026-sidearm:native:7800"],
  ["ouachita-baptist-volleyball-women-2026","college-ouachita-baptist-volleyball-women-2026-sidearm:native:6606"],
  ["southern-arkansas-volleyball-women-2026","college-southern-arkansas-volleyball-women-2026-sidearm:native:14731"],
  ["uam-volleyball-women-2026","college-uam-volleyball-women-2026-sidearm:native:8981"]
].map(([team_id,game_id])=>({code:"PAST_DUE_NONTERMINAL_DISPLAY",severity:"blocking",team_id,game_id}));
process.stdout.write(`
import { suppressAuditedRoutineDefects } from "./statewide-data-integrity-repair.js";
import { ensureOneTruthSchema, rebuildOneTruth } from "./one-truth.js";
const TOKEN=${JSON.stringify(token)};
const TARGETS=${JSON.stringify(targets)};
const FIXED_TEAM_IDS=["df-xatpsv-volleyball-2026","df-yj7aj5-volleyball-2026"];
function authorized(request){return request.headers.get("x-bounded-repair-token")===TOKEN;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==="HEAD"&&url.pathname==="/api/bounded-eight-defect-repair-ready"){
      return authorized(request)?new Response(null,{status:204,headers:{"cache-control":"no-store"}}):json({error:"not_found"},404);
    }
    if(request.method==="POST"&&url.pathname==="/api/bounded-eight-defect-repair-run"){
      if(!authorized(request)) return json({error:"not_found"},404);
      await ensureOneTruthSchema(env);
      const suppression=await suppressAuditedRoutineDefects(env,{issues:TARGETS});
      if(Number(suppression.issue_count||0)!==6) return json({status:"FAILURE",reason:"unexpected_issue_count",suppression},500);
      const touchedTeamIds=[...new Set([...(suppression.affected_team_ids||[]),...FIXED_TEAM_IDS].map(String).filter(Boolean))].sort();
      const oneTruth=await rebuildOneTruth(env,{teamIds:touchedTeamIds});
      return json({status:"SUCCESS",targets:TARGETS,touchedTeamIds,suppression,oneTruth});
    }
    return json({error:"not_found"},404);
  }
};
`);
NODE

UPLOAD_LOG="$TMPDIR/exec-upload.log"
wrangler versions upload "$EXEC_WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_LOG"

API="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$UPLOAD_LOG" | grep -m1 "https://${ALIAS}-${WORKER}\." || true)"
if [ -z "$API" ]; then API="$API_FALLBACK"; fi

READY=""
for ATTEMPT in $(seq 1 40); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-bounded-repair-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY" = "204" ]; then break; fi
  sleep 3
done
if [ "$READY" != "204" ]; then
  echo "Bounded repair preview never became ready: url=$API last_http=$READY" >&2
  exit 1
fi

OUT="$TMPDIR/result.json"
HTTP_STATUS="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}' -X POST -H "x-bounded-repair-token: $TOKEN" -H 'accept: application/json' -H 'cache-control: no-store' "$API$RUN_PATH")"
if [ "$HTTP_STATUS" != "200" ]; then
  echo "Bounded repair failed: HTTP $HTTP_STATUS" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(p.status!=="SUCCESS") throw new Error("Bounded repair did not return SUCCESS");
if((p.targets||[]).length!==6) throw new Error("Exact six-game scope violated");
if(Number(p.suppression?.issue_count||0)!==6) throw new Error("Suppression issue scope violated");
if(!(p.touchedTeamIds||[]).includes("df-xatpsv-volleyball-2026") || !(p.touchedTeamIds||[]).includes("df-yj7aj5-volleyball-2026")) {
  throw new Error("Lake Hamilton/Harmony Grove ONE_TRUTH scope missing");
}
NODE

node - "$OUT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs');
const body=fs.readFileSync(process.argv[2],'utf8');
process.stdout.write(`
const BODY=${JSON.stringify(body)};
export default {async fetch(){return new Response(BODY,{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}};
`);
NODE

wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars >/dev/null

echo "BOUNDED_EIGHT_DEFECT_REPAIR_PUBLISHED url=$API$RESULT_PATH"
