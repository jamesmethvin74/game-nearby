#!/usr/bin/env bash
set -euo pipefail

npm run check

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

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

OUT="$TMPDIR/final-logo-verification.json"
# The one and only final production D1 verification for statewide logo completion.
wrangler d1 execute localbleachersar-sports --remote --command="$VERIFY_SQL" --json > "$OUT"

RESULT="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const envelopes=Array.isArray(p)?p:[p];
const row=envelopes.flatMap(x=>x?.results||[]).find(Boolean);
if(!row) throw new Error('No final verification row');
const result={
  total:Number(row.total_schools||0),
  high:Number(row.high_schools||0),
  college:Number(row.colleges||0),
  withLogo:Number(row.schools_with_logo||0),
  missing:Number(row.missing_logos||0),
  missingRows:typeof row.missing==='string'?JSON.parse(row.missing):row.missing,
  rowsRead:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_read||x?.meta?.rowsRead||0),0),
  rowsWritten:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0)
};
console.log(JSON.stringify(result));
if(result.total!==336||result.high!==300||result.college!==36||result.withLogo!==336||result.missing!==0) process.exit(3);
NODE
)"

echo "FINAL_LOGO_VERIFICATION $RESULT"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "logos-336-complete" --keep-vars
