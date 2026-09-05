#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
SQL="WITH gp_school AS (
  SELECT id,name FROM schools WHERE level='high-school' AND state='AR' AND catalog_scope='local' AND lower(replace(name,'-',' ')) LIKE 'guy%perkins%'
), gp_team AS (
  SELECT t.id FROM teams t JOIN gp_school s ON s.id=t.school_id WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
), blevins_school AS (
  SELECT id,name FROM schools WHERE level='high-school' AND state='AR' AND catalog_scope='local' AND lower(replace(name,'-',' ')) LIKE 'blevins%'
), source_rows AS (
  SELECT g.id,g.opponent,g.opponent_school_id,g.team_score,g.opponent_score,g.scheduled_at,src.parser_type
  FROM games g JOIN teams t ON t.id=g.team_id JOIN blevins_school b ON b.id=t.school_id LEFT JOIN sources src ON src.id=g.source_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026' AND g.status='FINAL' AND g.team_score=12 AND g.opponent_score=28
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
), likely_source AS (
  SELECT * FROM source_rows r WHERE r.opponent_school_id IN (SELECT id FROM gp_school) OR lower(replace(COALESCE(r.opponent,''),'-',' ')) LIKE '%guy%perkins%'
), existing AS (
  SELECT g.id FROM games g JOIN teams t ON t.id=g.team_id JOIN gp_school s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026' AND g.status='FINAL' AND g.team_score=28 AND g.opponent_score=12
    AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
    AND (g.opponent_school_id IN (SELECT id FROM blevins_school) OR lower(replace(COALESCE(g.opponent,''),'-',' ')) LIKE 'blevins%')
)
SELECT
 (SELECT COUNT(*) FROM gp_school) school_count,
 (SELECT COUNT(*) FROM gp_team) team_count,
 (SELECT COUNT(*) FROM source_rows) blevins_score_rows,
 (SELECT COUNT(*) FROM likely_source) candidate_count,
 (SELECT COUNT(*) FROM likely_source WHERE parser_type='hootens-statewide') hootens_candidate_count,
 (SELECT COUNT(*) FROM existing) existing_count"
wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$TMP"
MARKER="$(node - "$TMP" <<'NODE'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const e=Array.isArray(p)?p:[p];const r=e.flatMap(x=>x?.results||[]).find(Boolean)||{};const w=e.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0);console.log(`gp-s${Number(r.school_count||0)}t${Number(r.team_count||0)}b${Number(r.blevins_score_rows||0)}c${Number(r.candidate_count||0)}h${Number(r.hootens_candidate_count||0)}e${Number(r.existing_count||0)}w${w}`.slice(0,32));
NODE
)"
echo "HOOTENS_GP_PREREQ $MARKER"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$MARKER" --keep-vars
