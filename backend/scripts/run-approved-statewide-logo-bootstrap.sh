#!/usr/bin/env bash
set -euo pipefail

TEMP_WORKER="localbleachersar-logo-bootstrap-exec"
TEMP_CONFIG=".wrangler-logo-bootstrap-exec.json"
EXEC_WRAPPER="src/_logo-bootstrap-exec.mjs"
RESULT_WRAPPER="src/_logo-bootstrap-result.mjs"
API="https://${TEMP_WORKER}.james-methvin74.workers.dev"
RESULT_PATH="/logo-bootstrap-result"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
HS_PATH="/api/v1/content/logo-bootstrap/high-school"
COLLEGE_PATH="/api/v1/content/logo-bootstrap/college"
TMPDIR="$(mktemp -d)"
TOKEN=""
TEMP_DEPLOYED=0
KEEP_RESULT=0

cleanup() {
  if [ "$TEMP_DEPLOYED" = "1" ] && [ "$KEEP_RESULT" != "1" ]; then
    printf 'y\n' | wrangler delete --config "$TEMP_CONFIG" >/dev/null 2>&1 || true
  fi
  rm -f "$EXEC_WRAPPER" "$RESULT_WRAPPER" "$TEMP_CONFIG"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

post_logo() {
  local path="$1" body="$2" outfile="$3" code
  code="$(curl -sS --max-time 180 -o "$outfile" -w '%{http_code}' -X POST \
    -H 'accept: application/json' \
    -H 'content-type: application/json' \
    -H 'cache-control: no-store' \
    -H "x-logo-bootstrap-token: $TOKEN" \
    --data "$body" "$API$path")"
  if [ "$code" != "200" ]; then
    echo "LOGO_BOOTSTRAP_HTTP_FAILURE path=$path code=$code" >&2
    cat "$outfile" >&2 || true
    return 1
  fi
}

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
node - "$TOKEN" > "$EXEC_WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import app from "./logo-bootstrap-worker.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction withToken(env){const wrapped=Object.create(env);Object.defineProperty(wrapped,"LOGO_BOOTSTRAP_TOKEN",{value:TOKEN,enumerable:true});return wrapped;}\nexport default {fetch(request,env,ctx){return app.fetch(request,withToken(env),ctx);}};\n`);
NODE

node > "$TEMP_CONFIG" <<'NODE'
console.log(JSON.stringify({
  name:"localbleachersar-logo-bootstrap-exec",
  main:"src/_logo-bootstrap-exec.mjs",
  compatibility_date:"2026-08-24",
  workers_dev:true,
  vars:{ENVIRONMENT:"production",LAZY_STATEWIDE_BOOTSTRAP:"1"},
  d1_databases:[{
    binding:"DB",
    database_name:"localbleachersar-sports",
    database_id:"50806cc9-7710-4f21-8ab3-159623f6a0a9"
  }]
},null,2));
NODE

# Deploy a temporary sibling Worker. Production Worker code/assets/routes are untouched.
wrangler deploy --config "$TEMP_CONFIG"
TEMP_DEPLOYED=1

READY_STATUS=""
for ATTEMPT in $(seq 1 20); do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-logo-bootstrap-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then
    echo "LOGO_BOOTSTRAP_READY attempt=$ATTEMPT"
    break
  fi
  echo "Logo bootstrap readiness attempt $ATTEMPT returned HTTP ${READY_STATUS:-curl_error}" >&2
  sleep 3
done
if [ "$READY_STATUS" != "204" ]; then
  echo "Logo bootstrap readiness never reached 204" >&2
  exit 1
fi

HS_TOTAL_WRITTEN=0
for BATCH in 1 2 3 4 5 6 7 8; do
  OUT="$TMPDIR/high-school-$BATCH.json"
  post_logo "$HS_PATH" '{"limit":25}' "$OUT"
  METRICS="$(node - "$OUT" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const status=String(p.status||''),written=Number(p.written||0);
if(!['COMPLETE','PARTIAL'].includes(status)) throw new Error(`Unexpected HS status ${status}`);
if(!Number.isFinite(written)||written<0||written>25) throw new Error(`HS cap violation ${written}`);
console.log([status,written,Number(p.missingBefore||0),Number(p.candidates||0),Array.isArray(p.sourceFailures)?p.sourceFailures.length:0,Array.isArray(p.unresolved)?p.unresolved.length:0,Number(p.rowsRead||0),Number(p.rowsWritten||0)].join('|'));
NODE
)"
  STATUS="${METRICS%%|*}"; REST="${METRICS#*|}"
  WRITTEN="${REST%%|*}"; REST="${REST#*|}"
  MISSING="${REST%%|*}"; REST="${REST#*|}"
  CANDIDATES="${REST%%|*}"; REST="${REST#*|}"
  SOURCE_FAILURES="${REST%%|*}"; REST="${REST#*|}"
  UNRESOLVED="${REST%%|*}"; REST="${REST#*|}"
  ROWS_READ="${REST%%|*}"; ROWS_WRITTEN="${REST#*|}"
  HS_TOTAL_WRITTEN=$((HS_TOTAL_WRITTEN + WRITTEN))
  echo "HS_LOGO_BATCH batch=$BATCH status=$STATUS missingBefore=$MISSING candidates=$CANDIDATES written=$WRITTEN sourceFailures=$SOURCE_FAILURES unresolved=$UNRESOLVED rowsRead=$ROWS_READ rowsWritten=$ROWS_WRITTEN totalWritten=$HS_TOTAL_WRITTEN"
  [ "$STATUS" = "COMPLETE" ] && break
  if [ "$WRITTEN" -eq 0 ]; then
    echo "HS_LOGO_SOURCE_LIMITED"
    cat "$OUT"
    break
  fi
done

COLLEGES=(
  uark arkansas-state uapb uca little-rock arkansas-tech uafs uam
  harding henderson-state ouachita-baptist southern-arkansas hendrix lyon ozarks arkansas-baptist
  cbc crowleys-ridge john-brown philander-smith williams-baptist asu-mid-south asu-mountain-home asu-newport
  asu-three-rivers national-park north-arkansas nwacc shorter south-arkansas seark sau-tech
  ua-rich-mountain ua-cossatot champion-christian ecclesia
)
COLLEGE_TOTAL_WRITTEN=0
for ((OFFSET=0; OFFSET<${#COLLEGES[@]}; OFFSET+=8)); do
  CHUNK=("${COLLEGES[@]:OFFSET:8}")
  BODY="$(printf '%s\n' "${CHUNK[@]}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({limit:8,schoolIds:s.trim().split(/\s+/).filter(Boolean)})))')"
  OUT="$TMPDIR/college-$OFFSET.json"
  post_logo "$COLLEGE_PATH" "$BODY" "$OUT"
  METRICS="$(node - "$OUT" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const attempted=Number(p.attempted||0),written=Number(p.written||0);
if(!Number.isFinite(attempted)||attempted<0||attempted>8) throw new Error(`College attempt cap violation ${attempted}`);
if(!Number.isFinite(written)||written<0||written>8) throw new Error(`College write cap violation ${written}`);
console.log([String(p.status||''),attempted,written,Array.isArray(p.failures)?p.failures.length:0,Number(p.rowsRead||0),Number(p.rowsWritten||0)].join('|'));
NODE
)"
  STATUS="${METRICS%%|*}"; REST="${METRICS#*|}"
  ATTEMPTED="${REST%%|*}"; REST="${REST#*|}"
  WRITTEN="${REST%%|*}"; REST="${REST#*|}"
  FAILURES="${REST%%|*}"; REST="${REST#*|}"
  ROWS_READ="${REST%%|*}"; ROWS_WRITTEN="${REST#*|}"
  COLLEGE_TOTAL_WRITTEN=$((COLLEGE_TOTAL_WRITTEN + WRITTEN))
  echo "COLLEGE_LOGO_BATCH offset=$OFFSET status=$STATUS attempted=$ATTEMPTED written=$WRITTEN failures=$FAILURES rowsRead=$ROWS_READ rowsWritten=$ROWS_WRITTEN totalWritten=$COLLEGE_TOTAL_WRITTEN"
  if [ "$FAILURES" -gt 0 ]; then
    echo "COLLEGE_LOGO_FAILURE_DETAIL offset=$OFFSET"
    cat "$OUT"
  fi
done

VERIFY_SQL="WITH visible AS (
  SELECT s.id,s.name,s.level,COALESCE(NULLIF(b.logo_url,''),NULLIF(s.logo_url,'')) AS logo_url
  FROM schools s LEFT JOIN school_brand_assets b ON b.school_id=s.id
  WHERE s.catalog_scope='local' AND (
    s.level='college' OR (s.level='high-school' AND s.id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp'))
  )
), missing AS (SELECT id,name,level FROM visible WHERE logo_url IS NULL)
SELECT
  (SELECT COUNT(*) FROM visible) AS total_schools,
  (SELECT COUNT(*) FROM visible WHERE level='high-school') AS high_schools,
  (SELECT COUNT(*) FROM visible WHERE level='college') AS colleges,
  (SELECT COUNT(*) FROM visible WHERE logo_url IS NOT NULL) AS schools_with_logo,
  (SELECT COUNT(*) FROM missing) AS missing_logos,
  COALESCE((SELECT json_group_array(json_object('id',id,'name',name,'level',level)) FROM missing),'[]') AS missing"
VERIFY_OUT="$TMPDIR/final-verification.json"

# Exactly one final set-based production D1 verification.
wrangler d1 execute localbleachersar-sports --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

RESULT_JSON="$TMPDIR/result.json"
node - "$VERIFY_OUT" "$TMPDIR" "$HS_TOTAL_WRITTEN" "$COLLEGE_TOTAL_WRITTEN" > "$RESULT_JSON" <<'NODE'
const fs=require('fs'),path=require('path');
const [verifyPath,tmpdir,hsWritten,collegeWritten]=process.argv.slice(2);
const parsed=JSON.parse(fs.readFileSync(verifyPath,'utf8'));
const envelopes=Array.isArray(parsed)?parsed:[parsed];
const row=envelopes.flatMap(x=>x?.results||[]).find(Boolean);
if(!row) throw new Error('Final production verification returned no row');
const meta=envelopes.map(x=>x?.meta||{});
const endpointFailures=[];
for(const name of fs.readdirSync(tmpdir).filter(n=>/^(high-school|college)-.*\.json$/.test(n))){
  try{
    const p=JSON.parse(fs.readFileSync(path.join(tmpdir,name),'utf8'));
    for(const f of p.sourceFailures||[]) endpointFailures.push({phase:'high-school',...f});
    for(const f of p.failures||[]) endpointFailures.push({phase:'college',...f});
    if((p.written||0)===0) for(const u of p.unresolved||[]) endpointFailures.push({phase:'high-school',reason:'unresolved',...u});
  }catch{}
}
const total=Number(row.total_schools||0),high=Number(row.high_schools||0),college=Number(row.colleges||0),withLogo=Number(row.schools_with_logo||0),missingCount=Number(row.missing_logos||0);
const missing=typeof row.missing==='string'?JSON.parse(row.missing):row.missing;
const universeOk=total===336&&high===300&&college===36;
const result={
  status:universeOk?(missingCount===0?'COMPLETE':'SOURCE_LIMITED'):'UNIVERSE_MISMATCH',
  totalSchools:total,highSchools:high,colleges:college,schoolsWithLogo:withLogo,missingLogos:missingCount,missing,
  hsWritten:Number(hsWritten),collegeWritten:Number(collegeWritten),endpointFailures,
  verificationRowsRead:meta.reduce((n,m)=>n+Number(m.rows_read||m.rowsRead||0),0),
  verificationRowsWritten:meta.reduce((n,m)=>n+Number(m.rows_written||m.rowsWritten||0),0)
};
process.stdout.write(JSON.stringify(result));
NODE

node - "$RESULT_JSON" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs'),result=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
process.stdout.write(`const RESULT=${JSON.stringify(result)};\nexport default {fetch(request){const u=new URL(request.url);if(u.pathname==="/logo-bootstrap-result")return Response.json(RESULT,{headers:{"cache-control":"no-store"}});return new Response("Not found",{status:404});}};\n`);
NODE
node - "$TEMP_CONFIG" <<'NODE'
const fs=require('fs'),p=process.argv[2],c=JSON.parse(fs.readFileSync(p,'utf8'));c.main='src/_logo-bootstrap-result.mjs';fs.writeFileSync(p,JSON.stringify(c,null,2));
NODE

# Replace the executable temp Worker with a read-only static result endpoint.
wrangler deploy --config "$TEMP_CONFIG"
KEEP_RESULT=1

echo "STATEWIDE_LOGO_RESULT_READY url=$API$RESULT_PATH"
cat "$RESULT_JSON"
