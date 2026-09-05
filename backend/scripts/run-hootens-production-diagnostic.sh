#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
WRAPPER="src/_hootens-diagnostic.mjs"
PROBE_WRAPPER="src/_hootens-parser-probe.mjs"
PROBE_ALIAS="hootens-parser-probe"
TMPDIR="$(mktemp -d)"
trap 'rm -f "$WRAPPER" "$PROBE_WRAPPER"; rm -rf "$TMPDIR"' EXIT

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
PROBE_OUT="$TMPDIR/probe.json"
PROBE_UPLOAD="$TMPDIR/probe-upload.txt"
wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$OUT"

cat > "$PROBE_WRAPPER" <<'EOF'
import { probeHootensScoreboard } from "./hootens-statewide-results.js";
export default {async fetch(){
  try {
    const result=await probeHootensScoreboard();
    return new Response(JSON.stringify({status:"OK",...result}),{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  } catch(error) {
    return new Response(JSON.stringify({status:"ERROR",error:String(error?.message||error)}),{status:500,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  }
}};
EOF

wrangler versions upload "$PROBE_WRAPPER" --preview-alias "$PROBE_ALIAS" --keep-vars 2>&1 | tee "$PROBE_UPLOAD" >/dev/null
PROBE_API="$(grep -Eo 'https://[A-Za-z0-9.-]+workers\.dev' "$PROBE_UPLOAD" | head -n1 || true)"
if [ -z "$PROBE_API" ]; then
  PROBE_API="https://${PROBE_ALIAS}-localbleachersar-sports-api.james-methvin74.workers.dev"
fi
CODE=""
for ATTEMPT in $(seq 1 8); do
  CODE="$(curl -sS --max-time 30 -o "$PROBE_OUT" -w '%{http_code}' "$PROBE_API" || true)"
  [ "$CODE" = "200" ] && break
  sleep 2
done
if [ "$CODE" != "200" ] && [ ! -s "$PROBE_OUT" ]; then
  printf '{"status":"ERROR","error":"probe-http-%s"}' "$CODE" > "$PROBE_OUT"
fi

ALIAS="$(node - "$OUT" "$PROBE_OUT" "$CODE" <<'NODE'
const fs=require('fs');
const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const row=(Array.isArray(payload)?payload:[payload]).flatMap(x=>x?.results||[]).find(Boolean)||{};
let raw='';let probe={};
try { raw=fs.readFileSync(process.argv[3],'utf8'); probe=JSON.parse(raw); }
catch { probe={status:'ERROR',error:`nonjson-${raw.slice(0,80)}`}; }
let pc='x';
if(probe?.conway){
  const nums=[Number(probe.conway.homeScore),Number(probe.conway.awayScore)].filter(Number.isFinite).sort((a,b)=>a-b);
  pc=nums.length===2?`f${nums[0]}x${nums[1]}`:'x';
}
const n=v=>Number(v||0);
const code=String(process.argv[4]||'x').replace(/[^0-9]/g,'').slice(0,3)||'x';
const errorSlug=String(probe?.error||'unknown').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,12)||'unknown';
const p=probe?.status==='OK'?String(n(probe.finals)):`e${errorSlug}`;
const alias=`hd-h${code}-p${p}-c${pc}-r${n(row.recent_canonical_finals)}`;
console.log(alias.slice(0,34));
NODE
)"

node - "$OUT" "$PROBE_OUT" > "$WRAPPER" <<'NODE'
const fs=require('fs');
const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const row=(Array.isArray(payload)?payload:[payload]).flatMap(x=>x?.results||[]).find(Boolean)||{};
for (const key of ['conway_canonical','conway_raw']) {
  if (typeof row[key]==='string') { try { row[key]=JSON.parse(row[key]); } catch {} }
}
let raw='';let probe={};
try { raw=fs.readFileSync(process.argv[3],'utf8'); probe=JSON.parse(raw); }
catch { probe={status:'ERROR',error:`nonjson-${raw.slice(0,200)}`}; }
const body=JSON.stringify({status:'HOOTENS_PRODUCTION_DIAGNOSTIC',probe,...row});
process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(body)},{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}};\n`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars
