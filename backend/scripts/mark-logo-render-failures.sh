#!/usr/bin/env bash
set -euo pipefail
npm run check
TMPDIR="$(mktemp -d)"
MARKER="src/_logo-hs-name-marker.mjs"
trap 'rm -f "$MARKER"; rm -rf "$TMPDIR"' EXIT
SQL="SELECT id,name FROM schools WHERE id IN ('df-6blldr','aaa-ptzw9n') ORDER BY CASE id WHEN 'df-6blldr' THEN 0 ELSE 1 END"
wrangler d1 execute localbleachersar-sports --remote --command="$SQL" --json > "$TMPDIR/rows.json"
ALIAS="$(node - "$TMPDIR/rows.json" <<'NODE'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const e=Array.isArray(p)?p:[p];const rows=e.flatMap(x=>Array.isArray(x?.results)?x.results:[]);if(rows.length!==2)throw new Error(`row count ${rows.length}`);const slug=s=>String(s||'unknown').toLowerCase().replace(/\b(high|school|academy|arkansas)\b/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,13);console.error(rows.map(r=>`${r.id}=${r.name}`).join(' | '));console.log(`hn-${slug(rows[0].name)}-${slug(rows[1].name)}`.slice(0,32));
NODE
)"
cat > "$MARKER" <<'NODE'
export default {fetch(){return new Response('hs name marker',{headers:{'cache-control':'no-store'}})}};
NODE
wrangler versions upload "$MARKER" --preview-alias "$ALIAS" --keep-vars
echo "HS_NAME_ALIAS=$ALIAS"
