#!/usr/bin/env bash
set -euo pipefail

PREVIEW_ALIAS="bounded-eight-defect-repair"
API="https://${PREVIEW_ALIAS}-localbleachersar-sports-api.james-methvin74.workers.dev"
WRAPPER="src/_bounded-eight-defect-repair.mjs"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TOKEN_ACTIVE=0

cleanup() {
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$PREVIEW_ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER"
}
trap cleanup EXIT

node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import { runDueCollections } from "./index.js";
import { ensureOneTruthSchema, rebuildOneTruth } from "./one-truth.js";
const TOKEN=${JSON.stringify(token)};
const SOURCE_IDS=${JSON.stringify([
  "college-arkansas-tech-volleyball-women-2026-sidearm",
  "college-ecclesia-soccer-men-2026-sidearm",
  "college-john-brown-volleyball-women-2026-sidearm",
  "college-ouachita-baptist-volleyball-women-2026-sidearm",
  "college-southern-arkansas-volleyball-women-2026-sidearm",
  "college-uam-volleyball-women-2026-sidearm"
])};
const FIXED_TEAM_IDS=["df-xatpsv-volleyball-2026","df-yj7aj5-volleyball-2026"];
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(request.method!=="POST"||url.pathname!=="/run"||request.headers.get("x-bounded-repair-token")!==TOKEN) return json({error:"not_found"},404);
  await ensureOneTruthSchema(env);
  const collection=await runDueCollections(env,{force:true,sourceIds:SOURCE_IDS,reason:"approved-eight-defect-repair"});
  if((collection.outcomes||[]).length!==SOURCE_IDS.length || collection.ok!==true) {
    return json({status:"FAILURE",sourceIds:SOURCE_IDS,collection},500);
  }
  const touched=[...new Set([...(collection.touchedTeamIds||[]),...FIXED_TEAM_IDS].map(String).filter(Boolean))].sort();
  const oneTruth=await rebuildOneTruth(env,{teamIds:touched});
  return json({status:"SUCCESS",sourceIds:SOURCE_IDS,touchedTeamIds:touched,collection,oneTruth});
}};
`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$PREVIEW_ALIAS" --keep-vars
TOKEN_ACTIVE=1

READY=""
for ATTEMPT in $(seq 1 20); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H "x-bounded-repair-token: $TOKEN" "$API/not-run" || true)"
  if [ "$READY" = "404" ]; then
    break
  fi
  sleep 3
done
if [ "$READY" != "404" ]; then
  echo "Bounded repair preview never became ready" >&2
  exit 1
fi

OUT="$(mktemp)"
CODE="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}' -X POST -H 'accept: application/json' -H 'content-type: application/json' -H "x-bounded-repair-token: $TOKEN" --data '{}' "$API/run")"
if [ "$CODE" != "200" ]; then
  echo "Bounded repair failed HTTP $CODE" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(p.status!=="SUCCESS") throw new Error("Bounded repair did not return SUCCESS");
if(!Array.isArray(p.sourceIds)||p.sourceIds.length!==6) throw new Error("Six-source scope violated");
if((p.collection?.outcomes||[]).length!==6 || p.collection?.ok!==true) throw new Error("Collection scope/outcome failed");
console.log(JSON.stringify({
  status:p.status,
  sourceIds:p.sourceIds,
  touchedTeamIds:p.touchedTeamIds,
  outcomes:(p.collection.outcomes||[]).map(x=>({sourceId:x.sourceId,status:x.status,gamesSeen:x.gamesSeen??null,touchedTeamIds:x.touchedTeamIds||[]})),
  oneTruth:p.oneTruth
}));
NODE

wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$PREVIEW_ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=0
rm -f "$OUT"
echo "BOUNDED_EIGHT_DEFECT_REPAIR_COMPLETE"
