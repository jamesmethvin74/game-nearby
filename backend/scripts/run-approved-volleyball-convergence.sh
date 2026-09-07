#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/internal/volleyball-convergence/ready"
RUN_PATH="/api/v1/internal/volleyball-convergence"
ACCOUNT_ID="588568148fa47810445f37081e49562c"
SCRIPT_NAME="localbleachersar-sports-api"
SECRET_NAME="VOLLEYBALL_CONVERGENCE_TOKEN"
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
    echo "VOLLEYBALL_CONVERGENCE_SECRET_INSTALLED attempt=$ATTEMPT"
    break
  fi
  echo "Volleyball convergence secret install attempt $ATTEMPT failed code=${SECRET_CODE:-curl_error}" >&2
  cat "$SECRET_OUT" >&2 || true
  sleep 3
done
if [ "$SECRET_OK" != "1" ]; then
  echo "Volleyball convergence secret installation failed after bounded retries" >&2
  exit 1
fi

READY_STATUS=""
for ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-volleyball-convergence-token: $TOKEN" \
    -H 'cache-control: no-store' \
    "$API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then
    echo "VOLLEYBALL_CONVERGENCE_READY attempt=$ATTEMPT"
    break
  fi
  echo "Volleyball convergence readiness attempt $ATTEMPT returned HTTP ${READY_STATUS:-curl_error}" >&2
  sleep 3
done
if [ "$READY_STATUS" != "204" ]; then
  echo "Volleyball convergence readiness never reached 204" >&2
  exit 1
fi

RUN_OUT="$TMPDIR/convergence.json"
RUN_CODE="$(curl -sS --max-time 180 -o "$RUN_OUT" -w '%{http_code}' -X POST \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  -H 'cache-control: no-store' \
  -H "x-volleyball-convergence-token: $TOKEN" \
  --data '{}' \
  "$API$RUN_PATH" || true)"
if [ "$RUN_CODE" != "200" ]; then
  echo "Volleyball convergence POST failed: HTTP ${RUN_CODE:-curl_error}" >&2
  cat "$RUN_OUT" >&2 || true
  exit 1
fi
node - "$RUN_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log('VOLLEYBALL_CONVERGENCE_RESULT='+JSON.stringify(p));
if(!['COMPLETE','ALREADY_COMPLETE'].includes(p.status)) throw new Error(`Unexpected convergence status ${p.status}`);
if(p.status==='COMPLETE' && p.checks && !Object.values(p.checks).every(Boolean)) throw new Error(`Convergence checks failed ${JSON.stringify(p.checks)}`);
NODE

verify_production() {
  local nonce="$1"
  for id in conway-volleyball-2026 df-bkc4ux-volleyball-2026 df-qyu4f7-volleyball-2026 df-x7qmns-volleyball-2026; do
    curl -fsS --max-time 45 -H 'cache-control: no-store' "$API/api/v1/teams/$id/schedule?proof=$nonce" -o "$TMPDIR/$id.json"
  done
  curl -fsS --max-time 45 -H 'cache-control: no-store' "$API/api/v1/standings?sport=volleyball&conference=6a-central&proof=$nonce" -o "$TMPDIR/6a.json"
  curl -fsS --max-time 45 -H 'cache-control: no-store' "$API/api/v1/standings?sport=volleyball&conference=3a-2&proof=$nonce" -o "$TMPDIR/3a2.json"
  curl -fsS --max-time 45 -H 'cache-control: no-store' "$API/api/v1/scores?since=2026-09-03T00%3A00%3A00.000Z&until=2026-09-05T00%3A00%3A00.000Z&sport=volleyball&proof=$nonce" -o "$TMPDIR/scores.json"
  curl -fsS --max-time 45 -H 'cache-control: no-store' "$API/api/v1/games?since=2026-09-03T00%3A00%3A00.000Z&until=2026-09-05T00%3A00%3A00.000Z&proof=$nonce" -o "$TMPDIR/games.json"

  node - "$TMPDIR" <<'NODE'
const fs=require('fs'), path=require('path');
const dir=process.argv[2];
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const fail=[];
function proofTeam(file,label,expected,sep3Opponent,sep3Score,extras=[]){
  const p=read(file),r=p.record||{},games=p.games||[];
  const rec=`${Number(r.wins||0)}-${Number(r.losses||0)}`;
  const conf=`${Number(r.conference_wins||0)}-${Number(r.conference_losses||0)}`;
  console.log(`${label} record=${rec} conf=${conf} conference_id=${r.conference_id||''}`);
  if(rec!==expected.overall) fail.push(`${label} overall ${rec} != ${expected.overall}`);
  if(conf!==expected.conf) fail.push(`${label} conference ${conf} != ${expected.conf}`);
  if(r.conference_id!==expected.conferenceId) fail.push(`${label} conference_id ${r.conference_id}`);
  const g=games.find(x=>String(x.scheduled_at||'').startsWith('2026-09-03') && String(x.opponent||'').toLowerCase().includes(sep3Opponent));
  console.log(`${label} Sep3=${g?JSON.stringify({opponent:g.opponent,status:g.status,score:`${g.team_score}-${g.opponent_score}`,result:g.result,conference_game:g.conference_game}):'MISSING'}`);
  if(!g || g.status!=='FINAL' || `${g.team_score}-${g.opponent_score}`!==sep3Score || Number(g.conference_game)!==1) fail.push(`${label} Sep3 final/conference mismatch`);
  for(const e of extras){
    const x=games.find(g=>g.status==='FINAL' && String(g.opponent||'').toLowerCase().startsWith(e.opponent));
    console.log(`${label} extra ${e.opponent}=${x?`${x.team_score}-${x.opponent_score} ${x.result}`:'MISSING'}`);
    if(!x || `${x.team_score}-${x.opponent_score}`!==e.score || x.result!==e.result) fail.push(`${label} ${e.opponent} mismatch`);
  }
}
proofTeam('conway-volleyball-2026.json','Conway',{overall:'5-4',conf:'1-0',conferenceId:'6a-central-volleyball'},'southwest','3-0',[{opponent:'little rock christian',score:'2-1',result:'W'}]);
proofTeam('df-bkc4ux-volleyball-2026.json','Southwest',{overall:'1-3',conf:'0-1',conferenceId:'6a-central-volleyball'},'conway','0-3');
proofTeam('df-qyu4f7-volleyball-2026.json','Flippin',{overall:'4-2',conf:'3-0',conferenceId:'3a-2-volleyball'},'melbourne','3-0',[{opponent:'bergman',score:'3-2',result:'W'},{opponent:'cotter',score:'0-2',result:'L'}]);
proofTeam('df-x7qmns-volleyball-2026.json','Melbourne',{overall:'3-1',conf:'2-1',conferenceId:'3a-2-volleyball'},'flippin','0-3');
function standings(file,label,checks){
  const rows=read(file).standings||[];
  for(const c of checks){
    const row=rows.find(r=>c.re.test(String(r.school_name||'')));
    console.log(`${label} ${c.name}=${row?`${row.conference_record} / ${row.overall_record}`:'MISSING'}`);
    if(!row || row.overall_record!==c.overall || row.conference_record!==c.conf) fail.push(`${label} ${c.name} standings mismatch`);
  }
}
standings('6a.json','6A Central',[{name:'Conway',re:/^conway$/i,overall:'5-4',conf:'1-0'},{name:'Southwest',re:/little rock southwest/i,overall:'1-3',conf:'0-1'}]);
standings('3a2.json','3A-2',[{name:'Flippin',re:/^flippin$/i,overall:'4-2',conf:'3-0'},{name:'Melbourne',re:/^melbourne$/i,overall:'3-1',conf:'2-1'}]);
const scores=read('scores.json').games||[];
function scorePair(a,b){
  const row=scores.find(g=>[g.home_school_name,g.away_school_name].map(x=>String(x||'').toLowerCase()).some(n=>n.includes(a)) && [g.home_school_name,g.away_school_name].map(x=>String(x||'').toLowerCase()).some(n=>n.includes(b)));
  console.log(`Scores ${a}/${b}=${row?`${row.status} ${row.home_score}-${row.away_score} conf=${row.conference_game}`:'MISSING'}`);
  if(!row || row.status!=='FINAL' || Number(row.conference_game)!==1) fail.push(`scores ${a}/${b} mismatch`);
}
scorePair('conway','southwest'); scorePair('flippin','melbourne');
const nearby=read('games.json').games||[];
function nearbyPair(a,b){
  const row=nearby.find(g=>[g.school_name,g.opponent].map(x=>String(x||'').toLowerCase()).some(n=>n.includes(a)) && [g.school_name,g.opponent].map(x=>String(x||'').toLowerCase()).some(n=>n.includes(b)));
  console.log(`Home ${a}/${b}=${row?`${row.status} ${row.team_score}-${row.opponent_score} conf=${row.conference_game}`:'MISSING'}`);
  if(!row || row.status!=='FINAL' || Number(row.conference_game)!==1) fail.push(`Home ${a}/${b} mismatch`);
}
nearbyPair('conway','southwest'); nearbyPair('flippin','melbourne');
if(fail.length){console.error('VOLLEYBALL_PROOF_FAILURES='+JSON.stringify(fail));process.exit(1);}
console.log('VOLLEYBALL_PRODUCTION_PROOF=PASS');
NODE
}

PROOF_OK=0
for ATTEMPT in 1 2 3 4 5 6; do
  echo "Volleyball production proof attempt $ATTEMPT/6"
  if verify_production "$(date +%s)-$ATTEMPT"; then
    PROOF_OK=1
    break
  fi
  sleep 3
done
if [ "$PROOF_OK" != "1" ]; then
  echo "Final volleyball production proof did not converge" >&2
  exit 1
fi

echo "STATEWIDE_VOLLEYBALL_CONVERGENCE_VERIFIED"
