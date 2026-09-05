#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
SQL="WITH h AS (
  SELECT last_event_count,details_json FROM statewide_collection_state WHERE id='hootens:football:current'
), recent_raw AS (
  SELECT lower(replace(s.name,'-',' ')) AS school_name,
         lower(replace(COALESCE(g.opponent,''),'-',' ')) AS opponent,
         g.team_score,g.opponent_score
  FROM games g JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026' AND g.status='FINAL'
    AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
), expected(weight,school_pat,opp_pat,team_score,opp_score) AS (
  VALUES
    (1,'jacksonville','southside',48,20),
    (2,'corning','lafayette',44,8),
    (4,'cedar ridge','cave city',34,28),
    (8,'guy%perkins','blevins',28,12),
    (16,'har%ber','northside',45,7),
    (32,'southside','sallisaw',28,39),
    (64,'gentry','jay',38,0),
    (128,'mansfield','mena',52,35),
    (256,'earle','helena',28,49),
    (512,'rose bud','midland',36,18)
), found AS (
  SELECT e.weight,EXISTS(
    SELECT 1 FROM recent_raw r
    WHERE r.school_name LIKE '%'||e.school_pat||'%'
      AND r.opponent LIKE '%'||e.opp_pat||'%'
      AND r.team_score=e.team_score AND r.opponent_score=e.opp_score
  ) AS present FROM expected e
), conway AS (
  SELECT ce.status,ce.home_score,ce.away_score,
         lower(COALESCE(hs.name,'')) AS home_name,lower(COALESCE(aws.name,'')) AS away_name
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
 (SELECT last_event_count FROM h) AS finals,
 (SELECT json_extract(details_json,'$.matched') FROM h) AS matched,
 (SELECT json_extract(details_json,'$.unmatched') FROM h) AS unmatched,
 (SELECT COUNT(*) FROM found WHERE present=1) AS recovered_found,
 (SELECT COALESCE(SUM(weight),0) FROM found WHERE present=1) AS present_mask,
 (SELECT status FROM conway) AS conway_status,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'conway%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END AS conway_score,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'bentonville%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END AS bentonville_score"
wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$TMP"
MARKER="$(node - "$TMP" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const e=Array.isArray(p)?p:[p];
const r=e.flatMap(x=>x?.results||[]).find(Boolean)||{};
const writes=e.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0);
const finals=Number(r.finals||0),matched=Number(r.matched||0),unmatched=Number(r.unmatched||0),found=Number(r.recovered_found||0),mask=Number(r.present_mask||0),cs=Number(r.conway_score),bs=Number(r.bentonville_score);
if(finals<90||matched!==finals||unmatched!==0||found!==10||mask!==1023||String(r.conway_status)!=='FINAL'||cs!==14||bs!==20||writes!==0){
  throw new Error(`HOOTENS_10OF10_VERIFY_FAILED ${JSON.stringify({finals,matched,unmatched,found,mask,conwayStatus:r.conway_status,cs,bs,writes})}`);
}
console.log(`hv-f${finals}m${matched}u0-r${found}k${mask}-c${cs}x${bs}`.slice(0,32));
NODE
)"
echo "HOOTENS_FINAL_PROOF $MARKER"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$MARKER" --keep-vars
