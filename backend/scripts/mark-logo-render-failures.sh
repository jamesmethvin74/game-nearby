#!/usr/bin/env bash
set -euo pipefail
npm run check
TMPDIR="$(mktemp -d)"
MARKER="src/_logo-hs-resolver.mjs"
trap 'rm -f "$MARKER"; rm -rf "$TMPDIR"' EXIT
SQL="SELECT id,name FROM schools WHERE catalog_scope='local' AND level='high-school' AND id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp') ORDER BY name,id LIMIT 1 OFFSET 252"
wrangler d1 execute localbleachersar-sports --remote --command="$SQL" --json > "$TMPDIR/row.json"
ALIAS="$(node - "$TMPDIR/row.json" <<'NODE'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const e=Array.isArray(p)?p:[p];const rows=e.flatMap(x=>Array.isArray(x?.results)?x.results:[]);if(rows.length!==1)throw new Error(`row count ${rows.length}`);const r=rows[0];const id=String(r.id||'unknown').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');console.error(`HS252_ID=${r.id} HS252_NAME=${r.name}`);console.log(`hs252-${id}`.slice(0,32));
NODE
)"
cat > "$MARKER" <<'NODE'
export default {fetch(){return new Response('hs resolver',{headers:{'cache-control':'no-store'}})}};
NODE
wrangler versions upload "$MARKER" --preview-alias "$ALIAS" --keep-vars
echo "HS252_ALIAS=$ALIAS"
