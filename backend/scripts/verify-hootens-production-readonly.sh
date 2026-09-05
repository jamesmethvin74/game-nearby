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
), recent_raw AS (
  SELECT lower(s.name) AS school_name, lower(COALESCE(g.opponent,'')) AS opponent,
         g.status, g.team_score, g.opponent_score
  FROM games g
  JOIN teams t ON t.id=g.team_id
  JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
    AND g.status='FINAL'
    AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
), expected(label,school_pat,opp_pat,team_score,opp_score) AS (
  VALUES
    ('jacksonville-southside','jacksonville','southside',48,20),
    ('corning-lafayette','corning','lafayette',44,8),
    ('cedar-ridge-cave-city','cedar ridge','cave city',34,28),
    ('guy-perkins-blevins','guy-perkins','blevins',28,12),
    ('har-ber-northside','har-ber','northside',45,7),
    ('fort-smith-southside-sallisaw','southside','sallisaw',28,39),
    ('gentry-jay','gentry','jay',38,0),
    ('mansfield-mena','mansfield','mena',52,35),
    ('earle-helena','earle','helena',28,49),
    ('rose-bud-midland','rose bud','midland',36,18)
), found AS (
  SELECT e.label,
         EXISTS(
           SELECT 1 FROM recent_raw r
           WHERE r.school_name LIKE '%'||e.school_pat||'%'
             AND r.opponent LIKE '%'||e.opp_pat||'%'
             AND r.team_score=e.team_score
             AND r.opponent_score=e.opp_score
         ) AS present
  FROM expected e
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
  (SELECT COUNT(*) FROM found WHERE present=1) AS recovered_found,
  (SELECT json_group_array(label) FROM found WHERE present=0) AS missing,
  (SELECT status FROM conway) AS conway_status,
  CASE
    WHEN (SELECT home_name FROM conway) LIKE 'conway%' THEN (SELECT home_score FROM conway)
    ELSE (SELECT away_score FROM conway)
  END AS conway_score,
  CASE
    WHEN (SELECT home_name FROM conway) LIKE 'bentonville%' THEN (SELECT home_score FROM conway)
    ELSE (SELECT away_score FROM conway)
  END AS bentonville_score"

wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$OUT"
node - "$OUT" <<'NODE'
const fs=require('fs');
const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const envelopes=Array.isArray(payload)?payload:[payload];
const row=envelopes.flatMap(x=>Array.isArray(x?.results)?x.results:[]).find(Boolean);
if(!row) throw new Error('No Hooten production verification row');
const proof={
  finals:Number(row.finals||0),
  matched:Number(row.matched||0),
  unmatched:Number(row.unmatched||0),
  recoveredFound:Number(row.recovered_found||0),
  missing:typeof row.missing==='string'?JSON.parse(row.missing):row.missing,
  conwayStatus:String(row.conway_status||''),
  conwayScore:Number(row.conway_score),
  bentonvilleScore:Number(row.bentonville_score),
  lastSuccess:row.hootens_last_success||null,
  rowsRead:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_read||x?.meta?.rowsRead||0),0),
  rowsWritten:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0)
};
console.log(JSON.stringify({status:'HOOTENS_PRODUCTION_READONLY_VERIFY',...proof}));
if(!proof.lastSuccess) throw new Error('Hooten state has no successful fetch');
if(proof.finals<90) throw new Error(`Expected at least 90 finals, found ${proof.finals}`);
if(proof.matched!==proof.finals || proof.unmatched!==0) throw new Error(`Hooten state incomplete ${proof.finals}/${proof.matched}/${proof.unmatched}`);
if(proof.recoveredFound!==10) throw new Error(`Only ${proof.recoveredFound}/10 formerly-unmatched games found; missing=${JSON.stringify(proof.missing)}`);
if(proof.conwayStatus!=='FINAL' || proof.conwayScore!==14 || proof.bentonvilleScore!==20) throw new Error(`Conway/Bentonville verification failed ${JSON.stringify(proof)}`);
if(proof.rowsWritten!==0) throw new Error(`Read-only verifier unexpectedly wrote ${proof.rowsWritten} rows`);
NODE
