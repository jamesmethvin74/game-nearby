#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
WORKER="localbleachersar-sports-api"
TMPDIR="$(mktemp -d)"
WRAPPER="src/_hootens-proof-marker.mjs"
trap 'rm -f "$WRAPPER"; rm -rf "$TMPDIR"' EXIT
OUT="$TMPDIR/verify.json"

SQL="WITH h AS (
  SELECT last_successful_fetch_at,last_event_count,details_json FROM statewide_collection_state WHERE id='hootens:football:current'
), recent_raw AS (
  SELECT lower(s.name) AS school_name,lower(COALESCE(g.opponent,'')) AS opponent,g.status,g.team_score,g.opponent_score
  FROM games g JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
    AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
), expected(label,weight,school_pat,opp_pat,team_score,opp_score) AS (
  VALUES
    ('jacksonville-southside',1,'jacksonville','southside',48,20),
    ('corning-lafayette',2,'corning','lafayette',44,8),
    ('cedar-ridge-cave-city',4,'cedar ridge','cave city',34,28),
    ('guy-perkins-blevins',8,'guy-perkins','blevins',28,12),
    ('har-ber-northside',16,'har-ber','northside',45,7),
    ('fort-smith-southside-sallisaw',32,'southside','sallisaw',28,39),
    ('gentry-jay',64,'gentry','jay',38,0),
    ('mansfield-mena',128,'mansfield','mena',52,35),
    ('earle-helena',256,'earle','helena',28,49),
    ('rose-bud-midland',512,'rose bud','midland',36,18)
), found AS (
  SELECT e.label,e.weight,
    EXISTS(SELECT 1 FROM recent_raw r
      WHERE r.school_name LIKE '%'||e.school_pat||'%'
        AND r.opponent LIKE '%'||e.opp_pat||'%'
        AND r.team_score=e.team_score AND r.opponent_score=e.opp_score) AS present
  FROM expected e
), conway AS (
  SELECT ce.status,ce.home_score,ce.away_score,lower(COALESCE(hs.name,'')) home_name,lower(COALESCE(aws.name,'')) away_name
  FROM canonical_events ce
  LEFT JOIN schools hs ON hs.id=ce.home_school_id
  LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026'
    AND datetime(ce.scheduled_at)>=datetime('now','-168 hours')
    AND ((lower(COALESCE(hs.name,'')) LIKE 'conway%' AND lower(COALESCE(aws.name,'')) LIKE 'bentonville%')
      OR (lower(COALESCE(aws.name,'')) LIKE 'conway%' AND lower(COALESCE(hs.name,'')) LIKE 'bentonville%'))
  ORDER BY datetime(ce.scheduled_at) DESC LIMIT 1
)
SELECT
 (SELECT last_event_count FROM h) finals,
 (SELECT json_extract(details_json,'$.matched') FROM h) matched,
 (SELECT json_extract(details_json,'$.unmatched') FROM h) unmatched,
 (SELECT COUNT(*) FROM found WHERE present=1) recovered_found,
 (SELECT COALESCE(SUM(weight),0) FROM found WHERE present=1) present_mask,
 (SELECT json_group_array(label) FROM found WHERE present=0) missing,
 (SELECT status FROM conway) conway_status,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'conway%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END conway_score,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'bentonville%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END bentonville_score"

wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$OUT"

MARKER="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const envs=Array.isArray(payload)?payload:[payload];
const row=envs.flatMap(x=>x?.results||[]).find(Boolean)||{};
const f=Number(row.finals||0),m=Number(row.matched||0),u=Number(row.unmatched||0),r=Number(row.recovered_found||0),k=Number(row.present_mask||0);
const c=Number(row.conway_score||0),b=Number(row.bentonville_score||0);
const w=envs.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0);
console.log(`hv-f${f}m${m}u${u}-r${r}k${k}-c${c}x${b}-w${w}`.slice(0,32));
console.error(JSON.stringify({row,rowsWritten:w}));
NODE
)"

node - "$MARKER" > "$WRAPPER" <<'NODE'
const marker=process.argv[2];
process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(marker)},{headers:{"content-type":"text/plain","cache-control":"no-store"}})}};\n`);
NODE
wrangler versions upload "$WRAPPER" --preview-alias "$MARKER" --keep-vars

echo "HOOTENS_PROOF_MARKER $MARKER"
