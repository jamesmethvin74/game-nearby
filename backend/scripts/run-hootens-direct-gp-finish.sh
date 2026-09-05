#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Keep the permanent Worker current before touching the one missing historical row.
wrangler deploy

SOURCE_OUT="$TMPDIR/source.json"
GAME_OUT="$TMPDIR/game.json"
RECORD_OUT="$TMPDIR/record.json"
VERIFY_OUT="$TMPDIR/verify.json"

SOURCE_SQL="WITH candidate AS (
  SELECT g.source_url
  FROM games g
  JOIN teams bt ON bt.id=g.team_id
  JOIN schools bs ON bs.id=bt.school_id
  JOIN sources src ON src.id=g.source_id
  WHERE bt.sport='football' AND bt.gender='boys' AND bt.season='2026'
    AND lower(replace(bs.name,'-',' '))='blevins'
    AND g.status='FINAL' AND g.team_score=12 AND g.opponent_score=28
    AND lower(replace(COALESCE(g.opponent,''),'-',' ')) LIKE '%guy%perkins%'
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
    AND (src.parser_type='hootens-statewide' OR lower(COALESCE(g.notes,'')) LIKE '%hooten%')
), target AS (
  SELECT t.id AS team_id
  FROM teams t JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
    AND lower(replace(s.name,'-',' '))='guy perkins'
)
INSERT OR IGNORE INTO sources(
  id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,
  expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,updated_at
)
SELECT target.team_id||'-hootens-gp-targeted',target.team_id,candidate.source_url,
       'secondary',90,'hootens-statewide','6','America/Chicago',1,30,5,0,90,180,CURRENT_TIMESTAMP
FROM target CROSS JOIN candidate
WHERE (SELECT COUNT(*) FROM target)=1 AND (SELECT COUNT(*) FROM candidate)=1"
wrangler d1 execute "$DB" --remote --command="$SOURCE_SQL" --json > "$SOURCE_OUT"

GAME_SQL="WITH candidate AS (
  SELECT g.scheduled_at,g.scheduled_time_known,g.venue,g.location_text,g.latitude,g.longitude,g.home_away,
         g.conference_game,g.counts_for_record,g.source_url,bt.school_id AS blevins_school_id,bs.name AS blevins_name
  FROM games g
  JOIN teams bt ON bt.id=g.team_id
  JOIN schools bs ON bs.id=bt.school_id
  JOIN sources src ON src.id=g.source_id
  WHERE bt.sport='football' AND bt.gender='boys' AND bt.season='2026'
    AND lower(replace(bs.name,'-',' '))='blevins'
    AND g.status='FINAL' AND g.team_score=12 AND g.opponent_score=28
    AND lower(replace(COALESCE(g.opponent,''),'-',' ')) LIKE '%guy%perkins%'
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
    AND (src.parser_type='hootens-statewide' OR lower(COALESCE(g.notes,'')) LIKE '%hooten%')
), target AS (
  SELECT t.id AS team_id,s.id AS school_id
  FROM teams t JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
    AND lower(replace(s.name,'-',' '))='guy perkins'
), vals AS (
  SELECT target.team_id,target.school_id,candidate.*,
         target.team_id||'-hootens-gp-targeted' AS target_source_id,
         'targeted:guy-perkins-blevins:'||substr(candidate.scheduled_at,1,10) AS event_key
  FROM target CROSS JOIN candidate
  WHERE (SELECT COUNT(*) FROM target)=1 AND (SELECT COUNT(*) FROM candidate)=1
)
INSERT OR IGNORE INTO games(
  id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,
  venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,
  team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id
)
SELECT target_source_id||':'||event_key,team_id,target_source_id,event_key,blevins_name,blevins_school_id,
       scheduled_at,COALESCE(scheduled_time_known,0),venue,location_text,latitude,longitude,
       CASE home_away WHEN 'home' THEN 'away' WHEN 'away' THEN 'home' WHEN 'neutral' THEN 'neutral' ELSE 'unknown' END,
       COALESCE(conference_game,0),COALESCE(counts_for_record,1),'FINAL',28,12,'W',
       'Hooten statewide final targeted Guy-Perkins schedule completion',source_url,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL
FROM vals
WHERE EXISTS(SELECT 1 FROM sources s WHERE s.id=vals.target_source_id)
  AND NOT EXISTS(
    SELECT 1 FROM games g
    WHERE g.team_id=vals.team_id AND g.status='FINAL' AND g.team_score=28 AND g.opponent_score=12
      AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
      AND (g.opponent_school_id=vals.blevins_school_id OR lower(replace(COALESCE(g.opponent,''),'-',' '))='blevins')
  )"
wrangler d1 execute "$DB" --remote --command="$GAME_SQL" --json > "$GAME_OUT"

GAME_WRITES="$(node - "$GAME_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const e=Array.isArray(p)?p:[p];
console.log(e.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0));
NODE
)"
if [ "$GAME_WRITES" -gt 1 ]; then
  echo "Refusing unexpected Guy-Perkins game write count: $GAME_WRITES" >&2
  exit 1
fi

# Only change the record when this run actually inserted the missing win.
if [ "$GAME_WRITES" = "1" ]; then
  RECORD_SQL="UPDATE team_records
    SET wins=wins+1,calculated_at=CURRENT_TIMESTAMP
    WHERE team_id=(
      SELECT t.id FROM teams t JOIN schools s ON s.id=t.school_id
      WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
        AND lower(replace(s.name,'-',' '))='guy perkins' LIMIT 1
    )"
  wrangler d1 execute "$DB" --remote --command="$RECORD_SQL" --json > "$RECORD_OUT"
else
  printf '[]\n' > "$RECORD_OUT"
fi

VERIFY_SQL="WITH h AS (
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
wrangler d1 execute "$DB" --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

MARKER="$(node - "$VERIFY_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const e=Array.isArray(p)?p:[p];
const r=e.flatMap(x=>x?.results||[]).find(Boolean)||{};
const writes=e.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0);
const finals=Number(r.finals||0),matched=Number(r.matched||0),unmatched=Number(r.unmatched||0),found=Number(r.recovered_found||0),mask=Number(r.present_mask||0),cs=Number(r.conway_score),bs=Number(r.bentonville_score);
if(finals<90||matched!==finals||unmatched!==0||found!==10||mask!==1023||String(r.conway_status)!=='FINAL'||cs!==14||bs!==20||writes!==0){
  throw new Error(`HOOTENS_DIRECT_VERIFY_FAILED ${JSON.stringify({finals,matched,unmatched,found,mask,conwayStatus:r.conway_status,cs,bs,writes})}`);
}
console.log(`hv-f${finals}m${matched}u0-r${found}k${mask}-c${cs}x${bs}-w0`.slice(0,32));
NODE
)"

echo "HOOTENS_DIRECT_GAME_WRITES $GAME_WRITES"
echo "HOOTENS_FINAL_PROOF $MARKER"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$MARKER" --keep-vars
