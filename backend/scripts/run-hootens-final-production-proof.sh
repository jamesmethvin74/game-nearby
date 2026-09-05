#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
OUT="$TMPDIR/proof.json"

SQL="WITH h AS (
  SELECT last_successful_fetch_at,last_event_count,details_json
  FROM statewide_collection_state
  WHERE id='hootens:football:current'
), conway AS (
  SELECT ce.status,ce.home_score,ce.away_score,hs.name AS home_name,aws.name AS away_name
  FROM canonical_events ce
  LEFT JOIN schools hs ON hs.id=ce.home_school_id
  LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026'
    AND datetime(ce.scheduled_at)>=datetime('now','-48 hours')
    AND ((lower(hs.name) LIKE 'conway%' AND lower(aws.name) LIKE 'bentonville%')
      OR (lower(hs.name) LIKE 'bentonville%' AND lower(aws.name) LIKE 'conway%'))
  ORDER BY datetime(ce.scheduled_at) DESC
  LIMIT 1
)
SELECT
  (SELECT last_successful_fetch_at FROM h) AS last_success,
  (SELECT last_event_count FROM h) AS final_rows,
  (SELECT json_extract(details_json,'$.matched') FROM h) AS matched,
  (SELECT json_extract(details_json,'$.unmatched') FROM h) AS unmatched,
  (SELECT status FROM conway) AS game_status,
  (SELECT home_name FROM conway) AS home_name,
  (SELECT home_score FROM conway) AS home_score,
  (SELECT away_name FROM conway) AS away_name,
  (SELECT away_score FROM conway) AS away_score"

wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$OUT"

ALIAS="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const r=(Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]).find(Boolean)||{};
const h=String(r.home_name||'').toLowerCase();
const a=String(r.away_name||'').toLowerCase();
const cs=h.startsWith('conway')?Number(r.home_score):a.startsWith('conway')?Number(r.away_score):NaN;
const bs=h.startsWith('bentonville')?Number(r.home_score):a.startsWith('bentonville')?Number(r.away_score):NaN;
const score=Number.isFinite(cs)&&Number.isFinite(bs)?`c${cs}x${bs}`:'cx';
console.log(`hv-${score}-f${Number(r.final_rows||0)}m${Number(r.matched||0)}u${Number(r.unmatched||0)}`.slice(0,34));
NODE
)"

wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars

node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const r=(Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]).find(Boolean);
if(!r) throw new Error('No production proof row');
const h=String(r.home_name||'').toLowerCase();
const a=String(r.away_name||'').toLowerCase();
const conway=h.startsWith('conway')?Number(r.home_score):a.startsWith('conway')?Number(r.away_score):NaN;
const bentonville=h.startsWith('bentonville')?Number(r.home_score):a.startsWith('bentonville')?Number(r.away_score):NaN;
if(r.game_status!=='FINAL' || conway!==14 || bentonville!==20) {
  throw new Error(`Expected Conway 14 - Bentonville 20 FINAL; got ${JSON.stringify(r)}`);
}
if(!r.last_success || Number(r.final_rows||0)<25) throw new Error(`Hooten state not healthy: ${JSON.stringify(r)}`);
console.log(JSON.stringify({status:'HOOTENS_FINAL_PRODUCTION_PROOF',conway,bentonville,finalRows:Number(r.final_rows||0),matched:Number(r.matched||0),unmatched:Number(r.unmatched||0),lastSuccess:r.last_success}));
NODE
