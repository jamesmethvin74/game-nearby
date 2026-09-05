#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
WORKER="localbleachersar-sports-api"
ALIAS="hootens-resilient-catchup"
API="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
READY_PATH="/api/hootens-resilient-ready"
RUN_PATH="/api/hootens-resilient-run"
WRAPPER="src/_hootens-resilient-catchup.mjs"
RESULT_WRAPPER="src/_hootens-resilient-proof.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TOKEN_ACTIVE=0

cleanup(){
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

node --check src/hootens-resilient-results.js
node --check src/milestone2-scheduled-worker.js
node --test test/hootens-resilient-results.test.js test/hootens-statewide-results.test.js

# Deploy the permanent scheduler/finalizer first.
wrangler deploy

node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import { runResilientHootensStatewideResults } from "./hootens-resilient-results.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction ok(req){return req.headers.get("x-hootens-resilient-token")===TOKEN;}\nfunction json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}\nexport default {async fetch(request,env){const path=new URL(request.url).pathname;if(request.method==="HEAD"&&path==="/api/hootens-resilient-ready")return ok(request)?new Response(null,{status:204}):json({error:"not_found"},404);if(request.method==="POST"&&path==="/api/hootens-resilient-run"){if(!ok(request))return json({error:"not_found"},404);const result=await runResilientHootensStatewideResults(env,{force:true});return json(result,result?.status==="SUCCESS"&&Number(result?.unmatched||0)===0?200:500);}return json({error:"not_found"},404);}};\n`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars
TOKEN_ACTIVE=1

READY=""
for ATTEMPT in $(seq 1 20); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-hootens-resilient-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY" = "204" ]; then break; fi
  sleep 3
done
if [ "$READY" != "204" ]; then
  echo "Hooten resilient preview never became ready" >&2
  exit 1
fi

RUN_OUT="$TMPDIR/run.json"
CODE="$(curl -sS --max-time 300 -o "$RUN_OUT" -w '%{http_code}' -X POST -H "x-hootens-resilient-token: $TOKEN" -H 'content-type: application/json' -H 'cache-control: no-store' --data '{}' "$API$RUN_PATH")"
cat "$RUN_OUT"
if [ "$CODE" != "200" ]; then
  echo "Hooten resilient catch-up failed HTTP $CODE" >&2
  exit 1
fi

read -r FINALS MATCHED UNMATCHED <<<"$(node - "$RUN_OUT" <<'NODE'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log([Number(p.finals||0),Number(p.matched||0),Number(p.unmatched||0)].join(' '));
NODE
)"
if [ "$FINALS" -lt 90 ] || [ "$MATCHED" -ne "$FINALS" ] || [ "$UNMATCHED" -ne 0 ]; then
  echo "Hooten resilient run incomplete: $FINALS/$MATCHED/$UNMATCHED" >&2
  exit 1
fi

wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=0

VERIFY_SQL="WITH h AS (
  SELECT last_successful_fetch_at,last_event_count,details_json FROM statewide_collection_state WHERE id='hootens:football:current'
), recent_raw AS (
  SELECT lower(s.name) AS school_name,lower(COALESCE(g.opponent,'')) AS opponent,g.status,g.team_score,g.opponent_score
  FROM games g JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026' AND g.status='FINAL'
    AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
), expected(label,school_pat,opp_pat,team_score,opp_score) AS (
  VALUES
    ('jacksonville-southside','jacksonville','southside',48,20),
    ('corning-lafayette','corning','lafayette',44,8),
    ('cedar-ridge-cave-city','cedar ridge','cave city',34,28),
    ('guy-perkins-blevins','guy-perkins','blevins',28,12),
    ('har-ber-northside','har-ber','northside',45,7),
    ('fort-smith-southside-sallisaw','southside','sallisaw',28,39),
    ('gentry-jay','gentry','jay',38,0),
    ('mansfield-mena','mansfield','mena',52,35),
    ('earle-helena','earle','helena',28,49),
    ('rose-bud-midland','rose bud','midland',36,18)
), found AS (
  SELECT e.label,EXISTS(SELECT 1 FROM recent_raw r WHERE r.school_name LIKE '%'||e.school_pat||'%' AND r.opponent LIKE '%'||e.opp_pat||'%' AND r.team_score=e.team_score AND r.opponent_score=e.opp_score) AS present FROM expected e
), conway AS (
  SELECT ce.status,ce.home_score,ce.away_score,lower(COALESCE(hs.name,'')) home_name,lower(COALESCE(aws.name,'')) away_name
  FROM canonical_events ce LEFT JOIN schools hs ON hs.id=ce.home_school_id LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026' AND datetime(ce.scheduled_at)>=datetime('now','-168 hours')
    AND ((lower(COALESCE(hs.name,'')) LIKE 'conway%' AND lower(COALESCE(aws.name,'')) LIKE 'bentonville%') OR (lower(COALESCE(aws.name,'')) LIKE 'conway%' AND lower(COALESCE(hs.name,'')) LIKE 'bentonville%'))
  ORDER BY datetime(ce.scheduled_at) DESC LIMIT 1
)
SELECT
 (SELECT last_event_count FROM h) finals,
 (SELECT json_extract(details_json,'$.matched') FROM h) matched,
 (SELECT json_extract(details_json,'$.unmatched') FROM h) unmatched,
 (SELECT COUNT(*) FROM found WHERE present=1) recovered_found,
 (SELECT json_group_array(label) FROM found WHERE present=0) missing,
 (SELECT status FROM conway) conway_status,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'conway%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END conway_score,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'bentonville%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END bentonville_score"
VERIFY_OUT="$TMPDIR/verify.json"
wrangler d1 execute "$DB" --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

MARKER="$(node - "$VERIFY_OUT" <<'NODE'
const fs=require('fs');const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const envs=Array.isArray(payload)?payload:[payload];const row=envs.flatMap(x=>x?.results||[]).find(Boolean);if(!row)throw new Error('no verification row');const f=Number(row.finals||0),m=Number(row.matched||0),u=Number(row.unmatched||0),r=Number(row.recovered_found||0),c=Number(row.conway_score),b=Number(row.bentonville_score),w=envs.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0);if(f<90||m!==f||u!==0||r!==10||row.conway_status!=='FINAL'||c!==14||b!==20||w!==0)throw new Error(`verify failed ${JSON.stringify(row)} writes=${w}`);console.log(`hr-f${f}m${m}u${u}-r${r}-c${c}x${b}`);
NODE
)"

node - "$MARKER" > "$RESULT_WRAPPER" <<'NODE'
const marker=process.argv[2];process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(marker)},{headers:{"content-type":"text/plain","cache-control":"no-store"}})}};\n`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$MARKER" --keep-vars
echo "HOOTENS_RESILIENT_PROOF $MARKER"
