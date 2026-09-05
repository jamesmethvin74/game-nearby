#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
WORKER="localbleachersar-sports-api"
ALIAS="hootens-complete-catchup"
API="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
READY_PATH="/api/hootens-complete-ready"
RUN_PATH="/api/hootens-complete-run"
WRAPPER="src/_hootens-complete-catchup.mjs"
RESULT_WRAPPER="src/_hootens-complete-result.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TOKEN_ACTIVE=0
KEEP_RESULT=0

cleanup(){
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# Targeted validation only. The Hooten completion path is deliberately isolated
# from unrelated content/logo tests while still syntax- and behavior-checking
# every module changed by this production fix.
node --check src/hootens-statewide-results.js
node --check src/hootens-complete-results.js
node --check src/milestone2-scheduled-worker.js
node --check src/collection-cadence.js
node --check src/logo-bootstrap-worker.js
node --test test/hootens-statewide-results.test.js

# Put the permanent scheduler/recovery code in production before invoking the
# one-time catch-up. This does not itself run a collection.
wrangler deploy

node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import { runCompleteHootensStatewideResults } from "./hootens-complete-results.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction ok(req){return req.headers.get("x-hootens-complete-token")===TOKEN;}\nfunction json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}\nexport default {async fetch(request,env){const path=new URL(request.url).pathname;if(request.method==="HEAD"&&path==="/api/hootens-complete-ready")return ok(request)?new Response(null,{status:204}):json({error:"not_found"},404);if(request.method==="POST"&&path==="/api/hootens-complete-run"){if(!ok(request))return json({error:"not_found"},404);const result=await runCompleteHootensStatewideResults(env,{force:true});return json(result,result?.status==="FAILURE"||result?.recoveryStatus==="FAILURE"?500:200);}return json({error:"not_found"},404);}};\n`);
NODE

# Isolated token-gated execution version. Production traffic remains on the
# permanent deployed Worker above.
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars
TOKEN_ACTIVE=1

READY=""
for ATTEMPT in $(seq 1 20); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-hootens-complete-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY" = "204" ]; then
    echo "HOOTENS_COMPLETE_READY attempt=$ATTEMPT"
    break
  fi
  sleep 3
done
if [ "$READY" != "204" ]; then
  echo "Hooten completion preview never became ready" >&2
  exit 1
fi

RUN_OUT="$TMPDIR/run.json"
CODE="$(curl -sS --max-time 300 -o "$RUN_OUT" -w '%{http_code}' -X POST \
  -H "x-hootens-complete-token: $TOKEN" -H 'content-type: application/json' -H 'cache-control: no-store' \
  --data '{}' "$API$RUN_PATH")"
if [ "$CODE" != "200" ]; then
  echo "Hooten completion catch-up failed: HTTP $CODE" >&2
  cat "$RUN_OUT" >&2 || true
  exit 1
fi
cat "$RUN_OUT"

read -r RUN_STATUS FINALS MATCHED UNMATCHED RECOVERED CREATED ALIASES <<<"$(node - "$RUN_OUT" <<'NODE'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log([p.status||'',Number(p.finals||0),Number(p.matched||0),Number(p.unmatched||0),Number(p.recoveredGames||0),Number(p.createdTeams||0),Number(p.aliasesWritten||0)].join(' '));
NODE
)"
if [ "$RUN_STATUS" != "SUCCESS" ]; then
  echo "Unexpected Hooten completion status: $RUN_STATUS" >&2
  exit 1
fi
if [ "$FINALS" -lt 90 ]; then
  echo "Hooten scoreboard returned suspiciously few finals: $FINALS" >&2
  exit 1
fi
if [ "$MATCHED" -ne "$FINALS" ] || [ "$UNMATCHED" -ne 0 ]; then
  echo "Hooten completion did not close all finals: finals=$FINALS matched=$MATCHED unmatched=$UNMATCHED" >&2
  exit 1
fi
if [ "$RECOVERED" -ne 10 ]; then
  echo "Expected the known 10 unmatched finals to be recovered, got $RECOVERED" >&2
  exit 1
fi

# Remove the temporary execution credential before querying production state.
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=0

# One combined bounded production verification read: Hooten state, Conway score
# orientation, and evidence that each of the ten formerly-unmatched games now has
# at least one persisted FINAL observation with the expected score orientation.
VERIFY_SQL="WITH h AS (
  SELECT last_successful_fetch_at,last_event_count,details_json
  FROM statewide_collection_state WHERE id='hootens:football:current'
), recent_canonical AS (
  SELECT ce.id,ce.scheduled_at,ce.status,ce.home_score,ce.away_score,
    hs.name AS home_name,aws.name AS away_name
  FROM canonical_events ce
  LEFT JOIN schools hs ON hs.id=ce.home_school_id
  LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026'
    AND datetime(ce.scheduled_at)>=datetime('now','-120 hours')
), conway AS (
  SELECT * FROM recent_canonical
  WHERE (lower(home_name) LIKE 'conway%' AND lower(away_name) LIKE 'bentonville%')
     OR (lower(home_name) LIKE 'bentonville%' AND lower(away_name) LIKE 'conway%')
  ORDER BY datetime(scheduled_at) DESC LIMIT 1
), recent_raw AS (
  SELECT lower(s.name) AS school_name,lower(g.opponent) AS opponent,
    g.status,g.team_score,g.opponent_score
  FROM games g
  JOIN teams t ON t.id=g.team_id
  JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
    AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
    AND datetime(g.scheduled_at)>=datetime('now','-120 hours')
), expected AS (
  SELECT 'jacksonville' school_key,48 team_score,20 opponent_score UNION ALL
  SELECT 'corning',44,8 UNION ALL
  SELECT 'cedar ridge',34,28 UNION ALL
  SELECT 'guy-perkins',28,12 UNION ALL
  SELECT 'har-ber',45,7 UNION ALL
  SELECT 'southside',28,39 UNION ALL
  SELECT 'gentry',38,0 UNION ALL
  SELECT 'mansfield',52,35 UNION ALL
  SELECT 'earle',28,49 UNION ALL
  SELECT 'rose bud',36,18
), recovered AS (
  SELECT e.school_key,
    EXISTS(SELECT 1 FROM recent_raw r
      WHERE r.school_name LIKE '%'||e.school_key||'%'
        AND r.team_score=e.team_score AND r.opponent_score=e.opponent_score) AS present
  FROM expected e
)
SELECT
  (SELECT last_successful_fetch_at FROM h) AS hootens_last_success,
  (SELECT last_event_count FROM h) AS hootens_final_rows,
  (SELECT json_extract(details_json,'$.matched') FROM h) AS hootens_matched,
  (SELECT json_extract(details_json,'$.unmatched') FROM h) AS hootens_unmatched,
  (SELECT json_extract(details_json,'$.recovery.recoveredGames') FROM h) AS recovery_games,
  (SELECT json_extract(details_json,'$.recovery.createdTeams') FROM h) AS recovery_created_teams,
  (SELECT COUNT(*) FROM recovered WHERE present=1) AS recovered_expected_rows,
  (SELECT json_group_array(school_key) FROM recovered WHERE present=0) AS missing_expected_rows,
  (SELECT json_object('id',id,'scheduled_at',scheduled_at,'status',status,'home_name',home_name,'away_name',away_name,'home_score',home_score,'away_score',away_score) FROM conway) AS conway_game"
VERIFY_OUT="$TMPDIR/verify.json"
wrangler d1 execute "$DB" --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

PROOF="$TMPDIR/proof.json"
node - "$VERIFY_OUT" "$FINALS" "$MATCHED" "$UNMATCHED" "$RECOVERED" "$PROOF" <<'NODE'
const fs=require('fs');
const [path,runFinals,runMatched,runUnmatched,runRecovered,proofPath]=process.argv.slice(2);
const payload=JSON.parse(fs.readFileSync(path,'utf8'));
const envelopes=Array.isArray(payload)?payload:[payload];
const row=envelopes.flatMap(x=>x?.results||[]).find(Boolean);
if(!row) throw new Error('No production verification row');
const conway=typeof row.conway_game==='string'?JSON.parse(row.conway_game):row.conway_game;
if(!row.hootens_last_success) throw new Error('Hooten state has no successful fetch');
const finals=Number(row.hootens_final_rows||0),matched=Number(row.hootens_matched||0),unmatched=Number(row.hootens_unmatched||0);
if(finals<90||matched!==finals||unmatched!==0) throw new Error(`Production Hooten state incomplete ${finals}/${matched}/${unmatched}`);
if(Number(row.recovery_games||0)!==10) throw new Error(`Production recovery count is ${row.recovery_games}, expected 10`);
if(Number(row.recovered_expected_rows||0)!==10) throw new Error(`Only ${row.recovered_expected_rows}/10 expected recovered score rows found; missing=${row.missing_expected_rows}`);
if(!conway) throw new Error('Conway vs Bentonville not found in recent canonical finals');
if(String(conway.status)!=='FINAL') throw new Error(`Conway game not FINAL: ${JSON.stringify(conway)}`);
let conwayScore=null,bentonvilleScore=null;
if(/^conway/i.test(String(conway.home_name||''))){conwayScore=Number(conway.home_score);bentonvilleScore=Number(conway.away_score);}
else if(/^conway/i.test(String(conway.away_name||''))){conwayScore=Number(conway.away_score);bentonvilleScore=Number(conway.home_score);}
if(conwayScore!==14||bentonvilleScore!==20) throw new Error(`Exact Conway/Bentonville score is wrong: ${JSON.stringify(conway)}`);
const meta={rowsRead:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_read||x?.meta?.rowsRead||0),0),rowsWritten:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0)};
const proof={status:'HOOTENS_COMPLETE_VERIFIED',run:{finals:Number(runFinals),matched:Number(runMatched),unmatched:Number(runUnmatched),recoveredGames:Number(runRecovered)},production:{finals,matched,unmatched,recoveredExpectedRows:Number(row.recovered_expected_rows),conwayScore,bentonvilleScore,recoveryCreatedTeams:Number(row.recovery_created_teams||0)},d1Meta:meta};
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2));
console.log(JSON.stringify(proof));
NODE

MARKER="$(node - "$PROOF" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const marker=`hc-f${p.production.finals}m${p.production.matched}u${p.production.unmatched}-c${p.production.conwayScore}x${p.production.bentonvilleScore}`;
if(marker.length>32) throw new Error(`Proof marker too long: ${marker}`);
console.log(marker);
NODE
)"

node - "$MARKER" > "$RESULT_WRAPPER" <<'NODE'
const marker=process.argv[2];
process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(marker)},{headers:{"content-type":"text/plain","cache-control":"no-store"}})}};\n`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$MARKER" --keep-vars
KEEP_RESULT=1

echo "HOOTENS_COMPLETE_PROOF $MARKER"
