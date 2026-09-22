#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ALIAS="bounded-source-repair-result"
WORKER="localbleachersar-sports-api"
API_FALLBACK="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
API=""
READY_PATH="/api/bounded-source-repair-ready"
RUN_PATH="/api/bounded-source-repair-run"
RESULT_PATH="/api/bounded-source-repair-result"
EXEC_WRAPPER="src/_bounded-source-repair-exec.mjs"
RESULT_WRAPPER="src/_bounded-source-repair-result.mjs"
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
const sourceIds=[
  "maxpreps-volleyball-results:df-7ds5mt-volleyball-2026",
  "df-7k6qj6-volleyball-2026-dragonfly-statewide",
  "df-7kza8c-volleyball-2026-dragonfly-statewide",
  "df-8pkud7-volleyball-2026-dragonfly-statewide",
  "df-a6slv2-volleyball-2026-dragonfly",
  "df-blzxrg-volleyball-2026-dragonfly-statewide",
  "df-bpy5n6-volleyball-2026-dragonfly-statewide",
  "df-cqpax3-volleyball-2026-dragonfly-statewide",
  "df-ee2ys7-volleyball-2026-dragonfly-statewide",
  "df-ev2nv9-volleyball-2026-dragonfly-statewide",
  "df-qgka87-volleyball-2026-dragonfly-statewide",
  "df-tnebcj-volleyball-2026-dragonfly-statewide",
  "df-wd92v5-volleyball-2026-dragonfly-statewide",
  "college-ozarks-soccer-men-2026-sidearm",
  "college-williams-baptist-soccer-men-2026-prestosports-rss"
];
const teamIds=[
  "df-7ds5mt-volleyball-2026",
  "df-7k6qj6-volleyball-2026",
  "df-7kza8c-volleyball-2026",
  "df-8pkud7-volleyball-2026",
  "df-a6slv2-volleyball-2026",
  "df-blzxrg-volleyball-2026",
  "df-bpy5n6-volleyball-2026",
  "df-cqpax3-volleyball-2026",
  "df-ee2ys7-volleyball-2026",
  "df-ev2nv9-volleyball-2026",
  "df-qgka87-volleyball-2026",
  "df-rpnt3m-volleyball-2026",
  "df-tnebcj-volleyball-2026",
  "df-wd92v5-volleyball-2026",
  "ozarks-soccer-men-2026",
  "williams-baptist-soccer-men-2026"
];
process.stdout.write(`
import { runDueCollections } from "./index.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { rebuildOneTruth } from "./one-truth.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
const TOKEN=${JSON.stringify(token)};
const SOURCES=${JSON.stringify(sourceIds)};
const TEAMS=${JSON.stringify(teamIds)};
function ok(req){return req.headers.get("x-bounded-repair-token")===TOKEN;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(request.method==="HEAD"&&path==="/api/bounded-source-repair-ready"){
      return ok(request)?new Response(null,{status:204,headers:{"cache-control":"no-store"}}):json({error:"not_found"},404);
    }
    if(request.method==="POST"&&path==="/api/bounded-source-repair-run"){
      if(!ok(request)) return json({error:"not_found"},404);
      try {
      const {results:sourceRows=[]}=await env.DB.prepare(
        "SELECT id FROM sources WHERE enabled=1 AND id IN (SELECT value FROM json_each(?)) ORDER BY id"
      ).bind(JSON.stringify(SOURCES)).all();
      const foundSources=new Set(sourceRows.map(row=>String(row.id)));
      const missingSources=SOURCES.filter(id=>!foundSources.has(id));

      const {results:teamRows=[]}=await env.DB.prepare(
        "SELECT id FROM teams WHERE active=1 AND season='2026' AND id IN (SELECT value FROM json_each(?)) ORDER BY id"
      ).bind(JSON.stringify(TEAMS)).all();
      const foundTeams=new Set(teamRows.map(row=>String(row.id)));
      const missingTeams=TEAMS.filter(id=>!foundTeams.has(id));

      if(missingSources.length||missingTeams.length){
        return json({
          status:"SCOPE_MISMATCH",
          requested_sources:SOURCES.length,
          found_sources:sourceRows.length,
          missing_sources:missingSources,
          requested_teams:TEAMS.length,
          found_teams:teamRows.length,
          missing_teams:missingTeams
        },200);
      }

      const collection=await runDueCollections(env,{
        force:true,
        sourceIds:SOURCES,
        reason:"approved-15-source-data-repair"
      });
      const recordRebuild=await rebuildTeamRecords(env,TEAMS,new Date().toISOString());
      const oneTruth=await rebuildOneTruth(env,{season:"2026",teamIds:TEAMS});
      const audit=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});

      return json({
        status:collection.ok?"SUCCESS":"PARTIAL_FAILURE",
        scope:{source_ids:SOURCES,team_ids:TEAMS},
        collection,
        record_rebuild:recordRebuild,
        one_truth:oneTruth,
        post_audit:audit
      });
      } catch(error) {
        return json({
          status:"EXECUTION_ERROR",
          scope:{source_ids:SOURCES,team_ids:TEAMS},
          error:String(error?.message||error).slice(0,2000)
        },200);
      }
    }
    return json({error:"not_found"},404);
  }
};
`);
NODE

UPLOAD_LOG="$TMPDIR/exec-upload.log"
wrangler versions upload "$EXEC_WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_LOG"

API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD_LOG" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
if [ -z "$API" ]; then API="$API_FALLBACK"; fi
echo "BOUNDED_REPAIR_PREVIEW_URL=$API"

READY=""
for ATTEMPT in $(seq 1 40); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-bounded-repair-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY" = "204" ]; then break; fi
  sleep 3
done
if [ "$READY" != "204" ]; then
  echo "Bounded repair preview never became ready: url=$API last_http=$READY" >&2
  exit 1
fi

OUT="$TMPDIR/repair.json"
HTTP_STATUS="$(curl -sS --max-time 600 -o "$OUT" -w '%{http_code}' -X POST \
  -H "x-bounded-repair-token: $TOKEN" -H 'accept: application/json' -H 'content-type: application/json' -H 'cache-control: no-store' \
  --data '{}' "$API$RUN_PATH")"
if [ "$HTTP_STATUS" != "200" ]; then
  echo "Bounded production repair failed: HTTP $HTTP_STATUS" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!Array.isArray(p?.scope?.source_ids)||p.scope.source_ids.length!==15) throw new Error('Source scope is not exactly 15');
if(!Array.isArray(p?.scope?.team_ids)||p.scope.team_ids.length!==16) throw new Error('Team scope is not exactly 16');
console.log("BOUNDED_REPAIR_STATUS="+String(p.status||"UNKNOWN"));
NODE

node - "$OUT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs');
const body=fs.readFileSync(process.argv[2],'utf8');
process.stdout.write(`
const BODY=${JSON.stringify(body)};
export default {
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path!=="/api/bounded-source-repair-result") return new Response(JSON.stringify({error:"not_found"}),{status:404,headers:{"content-type":"application/json"}});
    return new Response(BODY,{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  }
};
`);
NODE

wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars
echo "BOUNDED_SOURCE_REPAIR_PUBLISHED url=$API$RESULT_PATH"
