#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/internal/volleyball-convergence/ready"
RUN_PATH="/api/v1/internal/volleyball-convergence"
BATCH_KEY="aug24-external-opponents-v1"
TOKEN="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));process.stdout.write(String(p.vars.VOLLEYBALL_CONVERGENCE_TOKEN||''))")"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

if [ -z "$TOKEN" ]; then
  echo "Missing staged convergence token" >&2
  exit 1
fi

READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
  -H "x-volleyball-convergence-token: $TOKEN" \
  -H 'cache-control: no-store' \
  "$API$READY_PATH" || true)"
if [ "$READY_STATUS" != "204" ]; then
  echo "Staged-token volleyball convergence readiness failed: HTTP ${READY_STATUS:-curl_error}" >&2
  exit 1
fi
echo "AUG24_STATIC_READY"

RUN_OUT="$TMPDIR/convergence.json"
RUN_CODE="$(curl -sS --max-time 180 -o "$RUN_OUT" -w '%{http_code}' -X POST \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  -H 'cache-control: no-store' \
  -H "x-volleyball-convergence-token: $TOKEN" \
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
console.log('AUG24_STATIC_RESULT='+JSON.stringify(p));
const contests=['bf452b95-43e9-412c-8bbc-80fcd92ca147','01c9d8e3-fdea-4c12-879b-6a9f9726bb58','b3ba2de8-200c-412e-923e-7bad05699fd2'];
const teams=['df-ezw3f9-volleyball-2026','df-26g9fq-volleyball-2026','df-kybtet-volleyball-2026'];
if(p.batchKey!=='aug24-external-opponents-v1') throw new Error('Wrong batch key');
if(JSON.stringify([...(p.approvedContestIds||[])].sort())!==JSON.stringify([...contests].sort())) throw new Error('Approved contest set changed');
if(JSON.stringify([...(p.approvedTeamIds||[])].sort())!==JSON.stringify([...teams].sort())) throw new Error('Approved team set changed');
if(Number(p.preflight?.targetTeams)!==3 || Number(p.preflight?.conferenceCohorts||0)!==0) throw new Error('Unexpected preflight');
const r=p.result||{};
if(!['SUCCESS','NOT_MODIFIED'].includes(r.status)) throw new Error(`Unexpected collector status ${r.status}`);
if(Number(r.matchedFinals||0)>3 || Number(r.observations||0)>3 || Number(r.touchedTeams||0)>3) throw new Error('Logical write bounds exceeded');
if(Number(r.recordResult?.standings?.cohorts||0)!==0) throw new Error('Unexpected standings cohort write');
NODE

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
  const row=games.find(g=>{const h=norm(g.home_school_name),a=norm(g.away_school_name);return (h===localKey&&a===oppKey)||(h===oppKey&&a===localKey);});
  if(!row || row.status!=='FINAL') throw new Error(`Missing final ${e.local} vs ${e.opp}`);
  const localIsHome=norm(row.home_school_name)===localKey;
  const localScore=Number(localIsHome?row.home_score:row.away_score);
  const oppScore=Number(localIsHome?row.away_score:row.home_score);
  if(localScore!==e.localScore||oppScore!==e.oppScore) throw new Error(`Wrong score ${e.local} vs ${e.opp}`);
}
NODE

echo "AUG24_STATIC_VERIFIED"
