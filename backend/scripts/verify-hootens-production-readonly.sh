#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
OUT="$TMPDIR/verify.json"

SQL="WITH h AS (
  SELECT last_successful_fetch_at,last_event_count,details_json
  FROM statewide_collection_state
  WHERE id='hootens:football:current'
), conway AS (
  SELECT ce.status,ce.home_score,ce.away_score,
         lower(COALESCE(hs.name,'')) AS home_name,
         lower(COALESCE(aws.name,'')) AS away_name
  FROM canonical_events ce
  LEFT JOIN schools hs ON hs.id=ce.home_school_id
  LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026'
    AND datetime(ce.scheduled_at)>=datetime('now','-168 hours')
    AND ((lower(COALESCE(hs.name,'')) LIKE 'conway%' AND lower(COALESCE(aws.name,'')) LIKE 'bentonville%')
      OR (lower(COALESCE(aws.name,'')) LIKE 'conway%' AND lower(COALESCE(hs.name,'')) LIKE 'bentonville%'))
  ORDER BY datetime(ce.scheduled_at) DESC
  LIMIT 1
)
SELECT
  (SELECT last_successful_fetch_at FROM h) AS hootens_last_success,
  (SELECT last_event_count FROM h) AS finals,
  (SELECT json_extract(details_json,'$.matched') FROM h) AS matched,
  (SELECT json_extract(details_json,'$.unmatched') FROM h) AS unmatched,
  (SELECT status FROM conway) AS conway_status,
  CASE WHEN (SELECT home_name FROM conway) LIKE 'conway%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END AS conway_score,
  CASE WHEN (SELECT home_name FROM conway) LIKE 'bentonville%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END AS bentonville_score"

wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$OUT"
node - "$OUT" <<'NODE'
const fs=require('fs');
const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const envelopes=Array.isArray(payload)?payload:[payload];
const row=envelopes.flatMap(x=>Array.isArray(x?.results)?x.results:[]).find(Boolean);
if(!row) throw new Error('No Hooten production state row');
const finals=Number(row.finals||0),matched=Number(row.matched||0),unmatched=Number(row.unmatched||0);
const conwayScore=Number(row.conway_score),bentonvilleScore=Number(row.bentonville_score);
console.log(JSON.stringify({status:'HOOTENS_STATE_VERIFY',finals,matched,unmatched,lastSuccess:row.hootens_last_success||null,conwayStatus:row.conway_status||null,conwayScore,bentonvilleScore,rowsWritten:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0)}));
if(!row.hootens_last_success) throw new Error('Hooten state has no successful fetch');
if(finals<90||matched!==finals||unmatched!==0) throw new Error(`Hooten state incomplete ${finals}/${matched}/${unmatched}`);
if(String(row.conway_status)!=='FINAL'||conwayScore!==14||bentonvilleScore!==20) throw new Error('Conway/Bentonville verification failed');
NODE
