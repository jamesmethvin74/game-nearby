#!/usr/bin/env bash
set -euo pipefail

REPORT="$(mktemp)"
WRAPPER="src/_hootens-unmatched-marker.mjs"
trap 'rm -f "$REPORT" "$WRAPPER"' EXIT
URL="https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/diagnostics/hootens-unmatched"

CODE="$(curl -sS --max-time 60 -o "$REPORT" -w '%{http_code}' "$URL")"
if [ "$CODE" != "200" ]; then
  echo "live Hooten unmatched report failed: HTTP $CODE" >&2
  head -c 800 "$REPORT" >&2 || true
  exit 1
fi

MARKER="$(node - "$REPORT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(p?.status!=='SUCCESS') throw new Error(`audit failed ${JSON.stringify(p)}`);
const games=Array.isArray(p.unmatchedGames)?p.unmatchedGames:[];
const indexes=games.slice(0,10).map(g=>Number(g.index).toString(36).padStart(2,'0')).join('');
let anchorMask=0;
games.slice(0,10).forEach((g,i)=>{if(g.reason==='no_recent_game_anchor') anchorMask|=(1<<i);});
const marker=`h${games.length.toString(36)}-${indexes||'none'}-r${anchorMask.toString(16).padStart(3,'0')}`;
if(marker.length>32) throw new Error(`marker too long ${marker}`);
console.log(marker);
NODE
)"

echo "HOOTENS_UNMATCHED_MARKER $MARKER"
node - "$MARKER" > "$WRAPPER" <<'NODE'
const marker=process.argv[2];
process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(marker)},{headers:{"content-type":"text/plain","cache-control":"no-store"}})}};\n`);
NODE
wrangler versions upload "$WRAPPER" --preview-alias "$MARKER" --keep-vars
