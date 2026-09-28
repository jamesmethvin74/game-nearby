#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
MODE="${1:?mode required}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
case "$MODE" in
  fallback1) SQL="SELECT name FROM schools WHERE id='df-3y3kbw'" ; PREFIX="f1" ;;
  fallback2) SQL="SELECT name FROM schools WHERE id='df-hrdb8f'" ; PREFIX="f2" ;;
  wbb) SQL="SELECT name FROM schools WHERE id='df-qx6b5u'" ; PREFIX="wbb" ;;
  missing1) SQL="SELECT sch.name FROM teams t JOIN schools sch ON sch.id=t.school_id WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.id IN (SELECT team_id FROM team_external_identities WHERE provider='dragonfly:ArkAA:2026:WVB_Varsity') AND NOT EXISTS (SELECT 1 FROM games g JOIN sources src ON src.id=g.source_id WHERE g.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL AND COALESCE(g.counts_for_record,1)<>0) ORDER BY sch.name LIMIT 1" ; PREFIX="n1" ;;
  missing2) SQL="SELECT sch.name FROM teams t JOIN schools sch ON sch.id=t.school_id WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.id IN (SELECT team_id FROM team_external_identities WHERE provider='dragonfly:ArkAA:2026:WVB_Varsity') AND NOT EXISTS (SELECT 1 FROM games g JOIN sources src ON src.id=g.source_id WHERE g.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL AND COALESCE(g.counts_for_record,1)<>0) ORDER BY sch.name LIMIT 1 OFFSET 1" ; PREFIX="n2" ;;
  *) echo "bad mode" >&2; exit 2 ;;
esac
wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$TMP"
ALIAS="$(node - "$TMP" "$PREFIX" <<'NODE'
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const row=(Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]).find(Boolean);
if(!row?.name) throw new Error("name not found");
const slug=String(row.name).trim().toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const alias=process.argv[3]+"-"+slug;
if(alias.length>35) throw new Error("alias too long "+alias.length+" "+alias);
console.log(alias);
NODE
)"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "IDENTITY_NAME_ALIAS=$ALIAS"
