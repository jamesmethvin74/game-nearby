#!/usr/bin/env bash
set -euo pipefail

API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
HS_PATH="/api/v1/content/logo-bootstrap/high-school"
COLLEGE_PATH="/api/v1/content/logo-bootstrap/college"
TMPDIR="$(mktemp -d)"
TOKEN=""
SECRET_INSTALLED=0

cleanup() {
  rm -rf "$TMPDIR"
  if [ "$SECRET_INSTALLED" = "1" ]; then
    wrangler secret delete LOGO_BOOTSTRAP_TOKEN --yes >/dev/null 2>&1 || true
  fi
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
    echo "Logo bootstrap POST $path failed: HTTP $code" >&2
    cat "$outfile" >&2 || true
    exit 1
  fi
}

# Code verification and one native Cloudflare deploy. No migrations or collectors.
npm run check
wrangler deploy

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
printf '%s' "$TOKEN" | wrangler secret put LOGO_BOOTSTRAP_TOKEN
SECRET_INSTALLED=1

READY_STATUS=""
for ATTEMPT in 1 2 3 4 5 6 7 8; do
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

# High schools: at most 25 writes per invocation; stop on COMPLETE or no progress.
HS_TOTAL_WRITTEN=0
for BATCH in 1 2 3 4 5 6 7 8; do
  OUT="$TMPDIR/high-school-$BATCH.json"
  post_logo "$HS_PATH" '{"limit":25}' "$OUT"
  read -r STATUS WRITTEN MISSING CANDIDATES <<<"$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log([p.status||'',Number(p.written||0),Number(p.missingBefore||0),Number(p.candidates||0)].join(' '));
NODE
)"
  HS_TOTAL_WRITTEN=$((HS_TOTAL_WRITTEN + WRITTEN))
  echo "HS_LOGO_BATCH batch=$BATCH status=$STATUS missingBefore=$MISSING candidates=$CANDIDATES written=$WRITTEN"
  if [ "$STATUS" = "COMPLETE" ]; then break; fi
  if [ "$WRITTEN" -eq 0 ]; then break; fi
done

# Colleges: explicit 36-school inventory, chunked to the hard 8-school cap so
# one failed official site cannot starve later schools from being attempted.
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
  read -r STATUS ATTEMPTED WRITTEN FAILURES <<<"$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log([p.status||'',Number(p.attempted||0),Number(p.written||0),Array.isArray(p.failures)?p.failures.length:0].join(' '));
NODE
)"
  COLLEGE_TOTAL_WRITTEN=$((COLLEGE_TOTAL_WRITTEN + WRITTEN))
  COLLEGE_FAILURES=$((COLLEGE_FAILURES + FAILURES))
  echo "COLLEGE_LOGO_BATCH offset=$OFFSET status=$STATUS attempted=$ATTEMPTED written=$WRITTEN failures=$FAILURES"
done

# Exactly one final production D1 verification. It returns counts and any
# remaining missing identities in the same set-based query; no per-school reads.
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

node - "$VERIFY_OUT" "$HS_TOTAL_WRITTEN" "$COLLEGE_TOTAL_WRITTEN" "$COLLEGE_FAILURES" <<'NODE'
const fs=require('fs');
const [path,hsWritten,collegeWritten,collegeFailures]=process.argv.slice(2);
const parsed=JSON.parse(fs.readFileSync(path,'utf8'));
const envelopes=Array.isArray(parsed)?parsed:[parsed];
const row=envelopes.flatMap(item=>item?.results||[]).find(Boolean);
if(!row) throw new Error('Final production verification returned no row');
const result={
  totalSchools:Number(row.total_schools||0),
  highSchools:Number(row.high_schools||0),
  colleges:Number(row.colleges||0),
  schoolsWithLogo:Number(row.schools_with_logo||0),
  missingLogos:Number(row.missing_logos||0),
  missing:typeof row.missing==='string'?JSON.parse(row.missing):row.missing,
  hsWritten:Number(hsWritten),
  collegeWritten:Number(collegeWritten),
  collegeDiscoveryFailures:Number(collegeFailures)
};
console.log(JSON.stringify({status:'STATEWIDE_LOGO_BOOTSTRAP_VERIFIED',...result}));
if(result.totalSchools!==336) throw new Error(`Expected 336 user-facing schools, got ${result.totalSchools}`);
if(result.highSchools!==300) throw new Error(`Expected 300 high schools, got ${result.highSchools}`);
if(result.colleges!==36) throw new Error(`Expected 36 colleges, got ${result.colleges}`);
if(result.missingLogos!==0) throw new Error(`Logo completion still has ${result.missingLogos} missing: ${JSON.stringify(result.missing)}`);
NODE
