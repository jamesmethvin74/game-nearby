#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
SQL="SELECT last_successful_fetch_at,last_event_count,last_observation_count,last_source_count,
json_extract(details_json,'$.signature') AS signature,
COALESCE(json_extract(details_json,'$.unchanged'),0) AS unchanged,
COALESCE(json_extract(details_json,'$.touchedTeams'),0) AS touched_teams,
COALESCE(json_extract(details_json,'$.canonicalEvents'),0) AS canonical_events,
COALESCE(json_extract(details_json,'$.observations'),0) AS observations
FROM statewide_collection_state WHERE id='dragonfly:ArkAA:2026:WVB_Varsity'"
wrangler d1 execute "$DB" --remote --command="$SQL" --json > "$TMP"
ALIAS="$(node - "$TMP" <<'NODE'
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const row=(Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]).find(Boolean);
if(!row) throw new Error("missing WVB collection state");
const ran=Date.parse(row.last_successful_fetch_at||"")>=Date.parse("2026-09-28T00:48:00Z")?1:0;
const v2=String(row.signature||"").startsWith("volleyball-girls:v2:")?1:0;
const vals=[ran,v2,Number(row.unchanged||0),Number(row.last_event_count||0),Number(row.last_observation_count||0),Number(row.last_source_count||0),Number(row.touched_teams||0),Number(row.canonical_events||0),Number(row.observations||0)];
const enc=vals.map(v=>Math.max(0,Number(v)||0).toString(36));
const alias="s"+enc.join("-");
if(alias.length>35) throw new Error("alias too long "+alias);
console.log(alias);
NODE
)"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "WVB_STATE_MARKER=$ALIAS"
