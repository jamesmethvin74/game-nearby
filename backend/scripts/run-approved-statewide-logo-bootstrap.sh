#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
HS_PATH="/api/v1/content/logo-bootstrap/high-school"
COLLEGE_PATH="/api/v1/content/logo-bootstrap/college"
TMPDIR="$(mktemp -d)"
WRAPPER="src/_logo-execution-worker.mjs"
TOKEN=""
EPHEMERAL_DEPLOYED=0

cleanup() {
  if [ "$EPHEMERAL_DEPLOYED" = "1" ]; then
    wrangler deploy >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

post_logo() {
  local path="$1"
  local body="$2"
  local outfile="$3"
  local code
  code="$(curl -sS --max-time 180 -o "$outfile" -w '%{http_code}' -X POST \
    -H 'accept: application/json' \
    -H 'content-type: application/json' \
    -H 'cache-control: no-store' \
    -H "x-logo-bootstrap-token: $TOKEN" \
    --data "$body" \
    "$API$path")"
  if [ "$code" != "200" ]; then
    echo "LOGO_BOOTSTRAP_HTTP_FAILURE path=$path code=$code" >&2
    cat "$outfile" >&2 || true
    return 1
  fi
}

# Generate the execution credential only inside the authenticated Cloudflare
# build workspace. It is never committed or persisted as a Worker secret.
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token = process.argv[2];
process.stdout.write(`import app from "./logo-bootstrap-worker.js";\nconst EXECUTION_TOKEN=${JSON.stringify(token)};\nfunction executionEnv(env){const wrapped=Object.create(env);Object.defineProperty(wrapped,"LOGO_BOOTSTRAP_TOKEN",{value:EXECUTION_TOKEN,enumerable:true});return wrapped;}\nexport default {\n  fetch(request,env,ctx){return app.fetch(request,executionEnv(env),ctx);},\n  scheduled(controller,env,ctx){return app.scheduled(controller,env,ctx);}\n};\n`);
NODE

# Use Wrangler's positional entrypoint while retaining the normal project config.
wrangler deploy "$WRAPPER"
EPHEMERAL_DEPLOYED=1

READY_STATUS=""
for ATTEMPT in $(seq 1 20); do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-logo-bootstrap-token: $TOKEN" \
    -H 'cache-control: no-store' \
    "$API$READY_PATH" || true)"
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
HS_COMPLETE=0
for BATCH in 1 2 3 4 5 6 7 8; do
  OUT="$TMPDIR/high-school-$BATCH.json"
  post_logo "$HS_PATH" '{"limit":25}' "$OUT"
  METRICS="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const status=String(p.status||'');
const written=Number(p.written||0);
if(!['COMPLETE','PARTIAL'].includes(status)) throw new Error(`Unexpected HS status ${status}`);
if(!Number.isFinite(written)||written<0||written>25) throw new Error(`HS cap violation ${written}`);
console.log([
  status,written,Number(p.missingBefore||0),Number(p.candidates||0),
  Array.isArray(p.sourceFailures)?p.sourceFailures.length:0,
  Array.isArray(p.unresolved)?p.unresolved.length:0,
  Number(p.rowsRead||0),Number(p.rowsWritten||0)
].join('|'));
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
  if [ "$STATUS" = "COMPLETE" ]; then
    HS_COMPLETE=1
    break
  fi
  if [ "$WRITTEN" -eq 0 ]; then
    echo "HS_LOGO_SOURCE_LIMITED"
    cat "$OUT"
    break
  fi
done
if [ "$HS_COMPLETE" != "1" ]; then
  echo "HS logo execution completed bounded attempts without endpoint COMPLETE; continuing to colleges for source-limited final verification" >&2
fi

COLLEGES=(
  uark arkansas-state uapb uca little-rock arkansas-tech uafs uam
  harding henderson-state ouachita-baptist southern-arkansas hendrix lyon ozarks arkansas-baptist
  cbc crowleys-ridge john-brown philander-smith williams-baptist asu-mid-south asu-mountain-home asu-newport
  asu-three-rivers national-park north-arkansas nwacc shorter south-arkansas seark sau-tech
  ua-rich-mountain ua-cossatot champion-christian ecclesia
)
COLLEGE_TOTAL_WRITTEN=0
COLLEGE_FAILURES=0
for ((OFFSET=0; OFFSET<${#COLLEGES[@]}; OFFSET+=8)); do
  CHUNK=("${COLLEGES[@]:OFFSET:8}")
  BODY="$(printf '%s\n' "${CHUNK[@]}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({limit:8,schoolIds:s.trim().split(/\s+/).filter(Boolean)})))')"
  OUT="$TMPDIR/college-$OFFSET.json"
  post_logo "$COLLEGE_PATH" "$BODY" "$OUT"
  METRICS="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const attempted=Number(p.attempted||0);
const written=Number(p.written||0);
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
  COLLEGE_FAILURES=$((COLLEGE_FAILURES + FAILURES))
  echo "COLLEGE_LOGO_BATCH offset=$OFFSET status=$STATUS attempted=$ATTEMPTED written=$WRITTEN failures=$FAILURES rowsRead=$ROWS_READ rowsWritten=$ROWS_WRITTEN totalWritten=$COLLEGE_TOTAL_WRITTEN"
  if [ "$FAILURES" -gt 0 ]; then
    echo "COLLEGE_LOGO_FAILURE_DETAIL offset=$OFFSET"
    cat "$OUT"
  fi
done

# Exactly one final production D1 verification after all bounded logo writes.
VERIFY_SQL="WITH visible AS (
  SELECT s.id,s.name,s.level,COALESCE(NULLIF(b.logo_url,''),NULLIF(s.logo_url,'')) AS logo_url
  FROM schools s
  LEFT JOIN school_brand_assets b ON b.school_id=s.id
  WHERE s.catalog_scope='local'
    AND (
      s.level='college'
      OR (
        s.level='high-school'
        AND s.id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp')
      )
    )
), missing AS (
  SELECT id,name,level FROM visible WHERE logo_url IS NULL
)
SELECT
  (SELECT COUNT(*) FROM visible) AS total_schools,
  (SELECT COUNT(*) FROM visible WHERE level='high-school') AS high_schools,
  (SELECT COUNT(*) FROM visible WHERE level='college') AS colleges,
  (SELECT COUNT(*) FROM visible WHERE logo_url IS NOT NULL) AS schools_with_logo,
  (SELECT COUNT(*) FROM missing) AS missing_logos,
  COALESCE((SELECT json_group_array(json_object('id',id,'name',name,'level',level)) FROM missing),'[]') AS missing
"
VERIFY_OUT="$TMPDIR/final-verification.json"
wrangler d1 execute localbleachersar-sports --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

# Restore the clean production Worker before judging the verification result.
if ! wrangler deploy; then
  echo "CLEAN_WORKER_RESTORE_FAILED" >&2
  exit 1
fi
EPHEMERAL_DEPLOYED=0

node - "$VERIFY_OUT" "$HS_TOTAL_WRITTEN" "$COLLEGE_TOTAL_WRITTEN" "$COLLEGE_FAILURES" <<'NODE'
const fs=require('fs');
const [path,hsWritten,collegeWritten,collegeFailures]=process.argv.slice(2);
const parsed=JSON.parse(fs.readFileSync(path,'utf8'));
const envelopes=Array.isArray(parsed)?parsed:[parsed];
const row=envelopes.flatMap(item=>item?.results||[]).find(Boolean);
if(!row) throw new Error('Final production verification returned no row');
const meta=envelopes.map(item=>item?.meta||{});
const rowsRead=meta.reduce((n,m)=>n+Number(m.rows_read||m.rowsRead||0),0);
const rowsWritten=meta.reduce((n,m)=>n+Number(m.rows_written||m.rowsWritten||0),0);
const result={
  totalSchools:Number(row.total_schools||0),
  highSchools:Number(row.high_schools||0),
  colleges:Number(row.colleges||0),
  schoolsWithLogo:Number(row.schools_with_logo||0),
  missingLogos:Number(row.missing_logos||0),
  missing:typeof row.missing==='string'?JSON.parse(row.missing):row.missing,
  hsWritten:Number(hsWritten),
  collegeWritten:Number(collegeWritten),
  collegeDiscoveryFailures:Number(collegeFailures),
  verificationRowsRead:rowsRead,
  verificationRowsWritten:rowsWritten
};
console.log(JSON.stringify({status:'STATEWIDE_LOGO_BOOTSTRAP_VERIFIED',...result}));
if(result.totalSchools!==336) throw new Error(`Expected 336 user-facing schools, got ${result.totalSchools}`);
if(result.highSchools!==300) throw new Error(`Expected 300 high schools, got ${result.highSchools}`);
if(result.colleges!==36) throw new Error(`Expected 36 colleges, got ${result.colleges}`);
if(result.missingLogos!==0) throw new Error(`Logo completion still has ${result.missingLogos} missing: ${JSON.stringify(result.missing)}`);
NODE
