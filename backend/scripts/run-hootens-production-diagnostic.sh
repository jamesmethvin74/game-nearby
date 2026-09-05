#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
WRAPPER="src/_hootens-diagnostic.mjs"
TMPDIR="$(mktemp -d)"
trap 'rm -f "$WRAPPER"; rm -rf "$TMPDIR"' EXIT

SQL="WITH h AS (
  SELECT last_checked_at,last_successful_fetch_at,last_event_count,consecutive_failures,last_error,details_json
  FROM statewide_collection_state WHERE id='hootens:football:current'
), hoot_sources AS (
  SELECT COUNT(*) AS source_count FROM sources WHERE parser_type='hootens-statewide'
), hoot_games AS (
  SELECT COUNT(*) AS game_count, SUM(CASE WHEN status='FINAL' THEN 1 ELSE 0 END) AS final_count
  FROM games g JOIN sources s ON s.id=g.source_id WHERE s.parser_type='hootens-statewide'
), recent AS (
  SELECT ce.id,ce.scheduled_at,ce.status,ce.home_score,ce.away_score,hs.name AS home_name,aws.name AS away_name
  FROM canonical_events ce
  LEFT JOIN schools hs ON hs.id=ce.home_school_id
  LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026'
    AND datetime(ce.scheduled_at)>=datetime('now','-48 hours')
), conway_canonical AS (
  SELECT * FROM recent
  WHERE lower(COALESCE(home_name,'')) LIKE 'conway%' OR lower(COALESCE(away_name,'')) LIKE 'conway%'
  ORDER BY datetime(scheduled_at) DESC
), conway_raw AS (
  SELECT g.id,g.scheduled_at,g.status,g.team_score,g.opponent_score,g.opponent,g.canonical_event_id,s.parser_type,s.source_type,sch.name AS school_name
  FROM games g JOIN sources s ON s.id=g.source_id JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
    AND lower(sch.name) LIKE 'conway%'
    AND datetime(g.scheduled_at)>=datetime('now','-48 hours')
  ORDER BY datetime(g.scheduled_at) DESC,s.authority_rank,s.source_priority
)
SELECT
  (SELECT last_checked_at FROM h) AS h_last_checked,
  (SELECT last_successful_fetch_at FROM h) AS h_last_success,
  (SELECT last_event_count FROM h) AS h_event_count,
  (SELECT consecutive_failures FROM h) AS h_failures,
  (SELECT last_error FROM h) AS h_last_error,
  (SELECT details_json FROM h) AS h_details,
  (SELECT source_count FROM hoot_sources) AS hoot_source_count,
  (SELECT game_count FROM hoot_games) AS hoot_game_count,
  (SELECT final_count FROM hoot_games) AS hoot_game_finals,
  (SELECT COUNT(*) FROM recent WHERE status='FINAL' AND home_score IS NOT NULL AND away_score IS NOT NULL) AS recent_canonical_finals,
  COALESCE((SELECT json_group_array(json_object('id',id,'scheduled_at',scheduled_at,'status',status,'home_name',home_name,'away_name',away_name,'home_score',home_score,'away_score',away_score)) FROM conway_canonical),'[]') AS conway_canonical,
  COALESCE((SELECT json_group_array(json_object('id',id,'scheduled_at',scheduled_at,'status',status,'team_score',team_score,'opponent_score',opponent_score,'opponent',opponent,'canonical_event_id',canonical_event_id,'parser_type',parser_type,'source_type',source_type,'school_name',school_name)) FROM conway_raw),'[]') AS conway_raw"

OUT="$TMPDIR/diagnostic.json"
wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$OUT"

ALIAS="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const row=(Array.isArray(payload)?payload:[payload]).flatMap(x=>x?.results||[]).find(Boolean)||{};
let details={};
try { details=typeof row.h_details==='string'?JSON.parse(row.h_details):(row.h_details||{}); } catch {}
let canonical=[];
try { canonical=typeof row.conway_canonical==='string'?JSON.parse(row.conway_canonical):(row.conway_canonical||[]); } catch {}
const conway=canonical.find(x=>/conway/i.test(String(x.home_name||''))+ /bentonville/i.test(String(x.away_name||'')) || /bentonville/i.test(String(x.home_name||''))+ /conway/i.test(String(x.away_name||''))) || canonical[0] || null;
let c='x';
if (conway) {
  const nums=[Number(conway.home_score),Number(conway.away_score)].filter(Number.isFinite).sort((a,b)=>a-b);
  c=(String(conway.status)==='FINAL'?'f':'n')+(nums.length===2?`${nums[0]}x${nums[1]}`:'x');
}
const n=v=>Number(v||0);
const alias=`hd-e${n(row.h_event_count)}m${n(details.matched)}u${n(details.unmatched)}q${n(row.h_failures)}s${n(row.hoot_source_count)}g${n(row.hoot_game_count)}f${n(row.hoot_game_finals)}r${n(row.recent_canonical_finals)}c${c}`;
console.log(alias.slice(0,34));
NODE
)"

node - "$OUT" > "$WRAPPER" <<'NODE'
const fs=require('fs');
const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const row=(Array.isArray(payload)?payload:[payload]).flatMap(x=>x?.results||[]).find(Boolean)||{};
for (const key of ['conway_canonical','conway_raw']) {
  if (typeof row[key]==='string') { try { row[key]=JSON.parse(row[key]); } catch {} }
}
const body=JSON.stringify({status:'HOOTENS_PRODUCTION_DIAGNOSTIC',...row});
process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(body)},{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}};\n`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars
