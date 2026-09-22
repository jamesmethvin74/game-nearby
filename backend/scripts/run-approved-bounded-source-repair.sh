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
cleanup(){ rm -f "$EXEC_WRAPPER" "$RESULT_WRAPPER"; rm -rf "$TMPDIR"; }
trap cleanup EXIT INT TERM

node - "$TOKEN" > "$EXEC_WRAPPER" <<'NODE'
const token=process.argv[2];
const baseTeams=[
  "df-7ds5mt-volleyball-2026","df-7k6qj6-volleyball-2026","df-7kza8c-volleyball-2026",
  "df-8pkud7-volleyball-2026","df-a6slv2-volleyball-2026","df-blzxrg-volleyball-2026",
  "df-bpy5n6-volleyball-2026","df-cqpax3-volleyball-2026","df-ee2ys7-volleyball-2026",
  "df-ev2nv9-volleyball-2026","df-qgka87-volleyball-2026","df-rpnt3m-volleyball-2026",
  "df-tnebcj-volleyball-2026","df-wd92v5-volleyball-2026","ozarks-soccer-men-2026",
  "williams-baptist-soccer-men-2026"
];
process.stdout.write(`
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { rebuildOneTruth } from "./one-truth.js";
import { PRESENTATION_SUPPRESSED_NOTE } from "./current-schedule-truth.js";
const TOKEN=${JSON.stringify(token)};
const BASE_TEAMS=${JSON.stringify(baseTeams)};
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
      try{
        const before=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});
        const mismatches=(before.issues||[]).filter(x=>x.code==="SOURCE_FINAL_COUNT_VS_ONE_TRUTH");
        const gameIds=[...new Set(mismatches.flatMap(x=>(x.truth_only_finals||[]).map(g=>String(g.game_id||"")).filter(Boolean)))];
        if(gameIds.length>16) throw new Error("Consistency finalizer exceeded 16 game safety cap: "+gameIds.length);

        const {results:eligible=[]}=gameIds.length ? await env.DB.prepare(
          "SELECT g.id,g.team_id,g.canonical_event_id FROM games g JOIN canonical_events ce ON ce.id=g.canonical_event_id WHERE g.id IN (SELECT CAST(value AS TEXT) FROM json_each(?)) AND UPPER(COALESCE(ce.status,''))='FINAL' AND ce.home_score IS NOT NULL AND ce.away_score IS NOT NULL AND instr(COALESCE(g.notes,''),?)>0 ORDER BY g.id"
        ).bind(JSON.stringify(gameIds),PRESENTATION_SUPPRESSED_NOTE).all() : {results:[]};

        const eligibleIds=eligible.map(r=>String(r.id));
        let healed=0;
        if(eligibleIds.length){
          const result=await env.DB.prepare(
            "UPDATE games SET notes=NULLIF(TRIM(REPLACE(REPLACE(REPLACE(COALESCE(notes,''),' | '||?,''),?||' | ',''),?,'')),'') , updated_at=? WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?)) AND instr(COALESCE(notes,''),?)>0"
          ).bind(
            PRESENTATION_SUPPRESSED_NOTE,PRESENTATION_SUPPRESSED_NOTE,PRESENTATION_SUPPRESSED_NOTE,
            new Date().toISOString(),JSON.stringify(eligibleIds),PRESENTATION_SUPPRESSED_NOTE
          ).run();
          healed=Number(result?.meta?.changes||result?.changes||0);
        }

        const teamIds=[...new Set([...BASE_TEAMS,...mismatches.map(x=>String(x.team_id||"")).filter(Boolean),...eligible.map(x=>String(x.team_id||"")).filter(Boolean)])];
        const records=await rebuildTeamRecords(env,teamIds,new Date().toISOString());
        const oneTruth=await rebuildOneTruth(env,{season:"2026",teamIds});
        const after=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});
        return json({
          status:"SUCCESS",
          before_mismatches:mismatches.length,
          requested_game_ids:gameIds,
          eligible_game_ids:eligibleIds,
          healed_rows:healed,
          refreshed_team_ids:teamIds,
          record_rebuild:records,
          one_truth:oneTruth,
          post_audit:after
        });
      }catch(error){
        return json({status:"EXECUTION_ERROR",error:String(error?.message||error).slice(0,3000)},200);
      }
    }
    return json({error:"not_found"},404);
  }
};
`);
NODE

UPLOAD_LOG="$TMPDIR/exec-upload.log"
wrangler versions upload "$EXEC_WRAPPER" --preview-alias "$ALIAS" --keep-vars >"$UPLOAD_LOG" 2>&1
cat "$UPLOAD_LOG"
API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD_LOG" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
if [ -z "$API" ]; then API="$API_FALLBACK"; fi

READY=""
for ATTEMPT in $(seq 1 40); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-bounded-repair-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  [ "$READY" = "204" ] && break
  sleep 3
done
[ "$READY" = "204" ] || { echo "Finalizer preview never became ready: $READY" >&2; exit 1; }

OUT="$TMPDIR/repair.json"
HTTP="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}' -X POST -H "x-bounded-repair-token: $TOKEN" -H 'content-type: application/json' -H 'cache-control: no-store' --data '{}' "$API$RUN_PATH")"
[ "$HTTP" = "200" ] || { cat "$OUT" >&2 || true; exit 1; }

node - "$OUT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs');
const body=fs.readFileSync(process.argv[2],'utf8');
process.stdout.write(`
const BODY=${JSON.stringify(body)};
export default {async fetch(request){
  if(new URL(request.url).pathname!=="/api/bounded-source-repair-result") return new Response(JSON.stringify({error:"not_found"}),{status:404,headers:{"content-type":"application/json"}});
  return new Response(BODY,{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}};
`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars
echo "BOUNDED_REPAIR_FINALIZATION_PUBLISHED"
