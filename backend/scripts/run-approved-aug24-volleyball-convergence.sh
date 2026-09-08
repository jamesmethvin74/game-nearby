#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
RUN_PATH="/api/v1/internal/volleyball-convergence"
BATCH_KEY="aug24-external-opponents-v1"
ACCOUNT_ID="588568148fa47810445f37081e49562c"
SCRIPT_NAME="localbleachersar-sports-api"
SECRET_NAME="LOGO_BOOTSTRAP_TOKEN"
TMPDIR="$(mktemp -d)"
TOKEN=""
SECRET_INSTALLED=0

cleanup() {
  rm -rf "$TMPDIR"
  if [ "$SECRET_INSTALLED" = "1" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    curl -sS --max-time 30 -o /dev/null -X DELETE \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/secrets/$SECRET_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

npm run check
wrangler deploy

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Missing authenticated Cloudflare build token" >&2
  exit 1
fi

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
SECRET_BODY="$(node -e 'console.log(JSON.stringify({name:process.argv[1],text:process.argv[2],type:"secret_text"}))' "$SECRET_NAME" "$TOKEN")"
SECRET_OK=0
for ATTEMPT in 1 2 3; do
  SECRET_OUT="$TMPDIR/secret-put-$ATTEMPT.json"
  SECRET_CODE="$(curl -sS --max-time 30 -o "$SECRET_OUT" -w '%{http_code}' -X PUT \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    --data "$SECRET_BODY" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/secrets" || true)"
  if [ "$SECRET_CODE" = "200" ] && node - "$SECRET_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
process.exit(p?.success===true ? 0 : 1);
NODE
  then
    SECRET_INSTALLED=1
    SECRET_OK=1
    echo "AUG24_VOLLEYBALL_SECRET_INSTALLED attempt=$ATTEMPT"
    break
  fi
  echo "Temporary execution secret install attempt $ATTEMPT failed code=${SECRET_CODE:-curl_error}" >&2
  cat "$SECRET_OUT" >&2 || true
  sleep 3
done
if [ "$SECRET_OK" != "1" ]; then
  echo "Temporary execution secret installation failed after bounded retries" >&2
  exit 1
fi

READY_STATUS=""
for ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-logo-bootstrap-token: $TOKEN" \
    -H 'cache-control: no-store' \
    "$API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then
    echo "AUG24_VOLLEYBALL_READY attempt=$ATTEMPT"
    break
  fi
  echo "Execution readiness attempt $ATTEMPT returned HTTP ${READY_STATUS:-curl_error}" >&2
  sleep 3
done
if [ "$READY_STATUS" != "204" ]; then
  echo "Execution readiness never reached 204" >&2
  exit 1
fi

RUN_OUT="$TMPDIR/convergence.json"
RUN_CODE="$(curl -sS --max-time 180 -o "$RUN_OUT" -w '%{http_code}' -X POST \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  -H 'cache-control: no-store' \
  -H "x-logo-bootstrap-token: $TOKEN" \
  --data "{\"batchKey\":\"$BATCH_KEY\"}" \
  "$API$RUN_PATH" || true)"
if [ "$RUN_CODE" != "200" ]; then
  echo "Approved volleyball convergence POST failed: HTTP ${RUN_CODE:-curl_error}" >&2
  cat "$RUN_OUT" >&2 || true
  exit 1
fi

node - "$RUN_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log('AUG24_VOLLEYBALL_CONVERGENCE_RESULT='+JSON.stringify(p));
const contests=[
  'bf452b95-43e9-412c-8bbc-80fcd92ca147',
  '01c9d8e3-fdea-4c12-879b-6a9f9726bb58',
  'b3ba2de8-200c-412e-923e-7bad05699fd2'
];
const teams=[
  'df-ezw3f9-volleyball-2026',
  'df-26g9fq-volleyball-2026',
  'df-kybtet-volleyball-2026'
];
if(p.batchKey!=='aug24-external-opponents-v1') throw new Error(`Wrong batch key ${p.batchKey}`);
if(JSON.stringify([...(p.approvedContestIds||[])].sort())!==JSON.stringify([...contests].sort())) throw new Error('Approved contest set changed');
if(JSON.stringify([...(p.approvedTeamIds||[])].sort())!==JSON.stringify([...teams].sort())) throw new Error('Approved team set changed');
if(Number(p.preflight?.targetTeams)!==3 || Number(p.preflight?.conferenceCohorts||0)!==0) throw new Error(`Unexpected preflight ${JSON.stringify(p.preflight)}`);
const r=p.result||{};
if(!['SUCCESS','NOT_MODIFIED'].includes(r.status)) throw new Error(`Unexpected collector status ${r.status}`);
if(Number(r.matchedFinals||0)>3 || Number(r.observations||0)>3 || Number(r.touchedTeams||0)>3) throw new Error(`Logical write bounds exceeded ${JSON.stringify(r)}`);
if(Number(r.recordResult?.standings?.cohorts||0)!==0) throw new Error(`Unexpected standings cohort write ${JSON.stringify(r.recordResult?.standings)}`);
NODE

# One combined production verification read for all three approved finals.
VERIFY_OUT="$TMPDIR/scores.json"
curl -fsS --max-time 60 -H 'cache-control: no-store' \
  "$API/api/v1/scores?since=2026-08-24T05%3A00%3A00.000Z&until=2026-08-25T05%3A00%3A00.000Z&sport=volleyball&proof=$(date +%s)" \
  -o "$VERIFY_OUT"

node - "$VERIFY_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const games=Array.isArray(p.games)?p.games:[];
const norm=v=>String(v||'').toLowerCase().replace(/\b(high school|high|school|hs)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const expected=[
  {local:'Marion High School',opp:'Collierville',localScore:3,oppScore:1},
  {local:'Columbia Christian School',opp:'Word of God Academy',localScore:3,oppScore:1},
  {local:'Magnolia High School',opp:'Pleasant Grove',localScore:1,oppScore:3}
];
for(const e of expected){
  const localKey=norm(e.local),oppKey=norm(e.opp);
  const row=games.find(g=>{
    const h=norm(g.home_school_name),a=norm(g.away_school_name);
    return (h===localKey&&a===oppKey)||(h===oppKey&&a===localKey);
  });
  if(!row) throw new Error(`Missing verified final ${e.local} vs ${e.opp}`);
  if(row.status!=='FINAL') throw new Error(`Not final: ${e.local} vs ${e.opp}`);
  const localIsHome=norm(row.home_school_name)===localKey;
  const localScore=Number(localIsHome?row.home_score:row.away_score);
  const oppScore=Number(localIsHome?row.away_score:row.home_score);
  if(localScore!==e.localScore||oppScore!==e.oppScore) throw new Error(`Wrong score ${e.local} vs ${e.opp}: ${localScore}-${oppScore}`);
  console.log(`AUG24_VOLLEYBALL_VERIFIED ${e.local} ${localScore}-${oppScore} ${e.opp}`);
}
NODE

echo "AUG24_VOLLEYBALL_CONVERGENCE_VERIFIED"
