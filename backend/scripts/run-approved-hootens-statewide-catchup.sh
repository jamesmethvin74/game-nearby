#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
ALIAS="hootens-catchup"
API="https://${ALIAS}-localbleachersar-sports-api.james-methvin74.workers.dev"
WRAPPER="src/_hootens-catchup-exec.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TOKEN_ACTIVE=0

cleanup(){
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

npm run check

node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import { runHootensStatewideResults } from "./hootens-statewide-results.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction ok(req){return req.headers.get("x-hootens-catchup-token")===TOKEN;}\nfunction json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}\nexport default {async fetch(request,env){const path=new URL(request.url).pathname;if(request.method==="HEAD"&&path==="/ready")return ok(request)?new Response(null,{status:204}):json({error:"not_found"},404);if(request.method==="POST"&&path==="/run"){if(!ok(request))return json({error:"not_found"},404);const result=await runHootensStatewideResults(env,{force:true});return json(result,result?.status==="FAILURE"?500:200);}return json({error:"not_found"},404);}};\n`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars
TOKEN_ACTIVE=1

READY=""
for ATTEMPT in $(seq 1 20); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-hootens-catchup-token: $TOKEN" "$API/ready" || true)"
  [ "$READY" = "204" ] && break
  sleep 3
done
if [ "$READY" != "204" ]; then
  echo "Hooten catch-up preview never became ready" >&2
  exit 1
fi

RUN_OUT="$TMPDIR/run.json"
CODE="$(curl -sS --max-time 300 -o "$RUN_OUT" -w '%{http_code}' -X POST -H "x-hootens-catchup-token: $TOKEN" -H 'content-type: application/json' --data '{}' "$API/run")"
if [ "$CODE" != "200" ]; then
  echo "Hooten statewide catch-up failed: HTTP $CODE" >&2
  cat "$RUN_OUT" >&2 || true
  exit 1
fi
cat "$RUN_OUT"

read -r RUN_STATUS FINALS MATCHED UNMATCHED TOUCHED <<<"$(node - "$RUN_OUT" <<'NODE'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log([p.status||'',Number(p.finals||0),Number(p.matched||0),Number(p.unmatched||0),Number(p.touchedTeams||0)].join(' '));
NODE
)"
if [ "$RUN_STATUS" != "SUCCESS" ] && [ "$RUN_STATUS" != "NOT_MODIFIED" ]; then
  echo "Unexpected Hooten catch-up status: $RUN_STATUS" >&2
  exit 1
fi
if [ "$FINALS" -lt 25 ]; then
  echo "Hooten scoreboard returned suspiciously few finals: $FINALS" >&2
  exit 1
fi

# Remove the temporary execution credential before production verification.
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars
TOKEN_ACTIVE=0

VERIFY_SQL="WITH h AS (
  SELECT last_successful_fetch_at,last_event_count,details_json FROM statewide_collection_state WHERE id='hootens:football:current'
), recent AS (
  SELECT ce.id,ce.scheduled_at,ce.status,ce.home_score,ce.away_score,hs.name AS home_name,aws.name AS away_name
  FROM canonical_events ce
  LEFT JOIN schools hs ON hs.id=ce.home_school_id
  LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026'
    AND datetime(ce.scheduled_at)>=datetime('now','-48 hours')
), conway AS (
  SELECT * FROM recent
  WHERE (lower(home_name) LIKE 'conway%' AND lower(away_name) LIKE 'bentonville%')
     OR (lower(home_name) LIKE 'bentonville%' AND lower(away_name) LIKE 'conway%')
  ORDER BY datetime(scheduled_at) DESC LIMIT 1
)
SELECT
  (SELECT last_successful_fetch_at FROM h) AS hootens_last_success,
  (SELECT last_event_count FROM h) AS hootens_final_rows,
  (SELECT json_extract(details_json,'$.matched') FROM h) AS hootens_matched,
  (SELECT json_extract(details_json,'$.unmatched') FROM h) AS hootens_unmatched,
  (SELECT COUNT(*) FROM recent WHERE status='FINAL' AND home_score IS NOT NULL AND away_score IS NOT NULL) AS recent_canonical_finals,
  (SELECT json_object('id',id,'scheduled_at',scheduled_at,'status',status,'home_name',home_name,'away_name',away_name,'home_score',home_score,'away_score',away_score) FROM conway) AS conway_game"
VERIFY_OUT="$TMPDIR/verify.json"
wrangler d1 execute "$DB" --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

node - "$VERIFY_OUT" "$FINALS" "$MATCHED" "$UNMATCHED" "$TOUCHED" <<'NODE'
const fs=require('fs');
const [path,runFinals,runMatched,runUnmatched,runTouched]=process.argv.slice(2);
const payload=JSON.parse(fs.readFileSync(path,'utf8'));
const row=(Array.isArray(payload)?payload:[payload]).flatMap(x=>x?.results||[]).find(Boolean);
if(!row) throw new Error('No production verification row');
const conway=typeof row.conway_game==='string'?JSON.parse(row.conway_game):row.conway_game;
if(!row.hootens_last_success) throw new Error('Hooten state has no successful fetch');
if(Number(row.hootens_final_rows||0)<25) throw new Error(`Too few Hooten final rows ${row.hootens_final_rows}`);
if(!conway) throw new Error('Conway vs Bentonville not found in recent canonical finals');
if(String(conway.status)!=='FINAL') throw new Error(`Conway game not FINAL: ${JSON.stringify(conway)}`);
const scores=[Number(conway.home_score),Number(conway.away_score)].sort((a,b)=>a-b);
if(scores[0]!==14||scores[1]!==20) throw new Error(`Conway/Bentonville score is not 14-20: ${JSON.stringify(conway)}`);
console.log(JSON.stringify({status:'HOOTENS_STATEWIDE_CATCHUP_VERIFIED',run:{finals:Number(runFinals),matched:Number(runMatched),unmatched:Number(runUnmatched),touchedTeams:Number(runTouched)},production:{hootensLastSuccess:row.hootens_last_success,hootensFinalRows:Number(row.hootens_final_rows||0),hootensMatched:Number(row.hootens_matched||0),hootensUnmatched:Number(row.hootens_unmatched||0),recentCanonicalFinals:Number(row.recent_canonical_finals||0),conway}}));
NODE
