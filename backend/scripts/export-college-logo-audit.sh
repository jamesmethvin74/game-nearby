#!/usr/bin/env bash
set -euo pipefail

REPORT_URL='https://college-logo-app-audit-localbleachersar-sports-api.james-methvin74.workers.dev'
OUT="$PWD/college-logo-app-audit-production.json"

curl -fsS --max-time 45 "$REPORT_URL" -o "$OUT"

COMPACT="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(Number(p?.counts?.total)!==36) throw new Error(`expected 36 colleges, got ${p?.counts?.total}`);
const codes={
'uark':'ua','arkansas-state':'as','uapb':'up','uca':'uc','little-rock':'lr','arkansas-tech':'at','uafs':'uf','uam':'um','harding':'ha','henderson-state':'hs','ouachita-baptist':'ob','southern-arkansas':'sa','hendrix':'he','lyon':'ly','ozarks':'oz','arkansas-baptist':'ab','cbc':'cb','crowleys-ridge':'cr','john-brown':'jb','philander-smith':'ps','williams-baptist':'wb','asu-mid-south':'ms','asu-mountain-home':'mh','asu-newport':'np','asu-three-rivers':'tr','national-park':'pk','north-arkansas':'na','nwacc':'nw','shorter':'sh','south-arkansas':'so','seark':'se','sau-tech':'st','ua-rich-mountain':'rm','ua-cossatot':'co','champion-christian':'cc','ecclesia':'ec'
};
const failures=Array.isArray(p.failures)?p.failures:[];
const ids=failures.map(x=>codes[String(x.schoolId)]||'xx').join('-') || 'none';
console.log(`${Number(p?.counts?.appFallback||0)}-${ids}`);
NODE
)"

DETAIL="$(node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log(JSON.stringify({counts:p.counts,failures:p.failures,d1Meta:p.d1Meta}));
NODE
)"

echo "COLLEGE_LOGO_AUDIT_EXPORTED $COMPACT"

# The Worker name consumes 28 DNS-label characters, so keep this alias short.
SAFE_ALIAS="ca-${COMPACT}"
SAFE_ALIAS="${SAFE_ALIAS:0:32}"
node --input-type=module - "$OUT" <<'NODE'
import fs from 'node:fs';
const body=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync('src/college-logo-audit-export-worker.js', `const BODY=${JSON.stringify(body)};export default{async fetch(){return new Response(BODY,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}};`);
NODE
wrangler versions upload src/college-logo-audit-export-worker.js \
  --preview-alias "$SAFE_ALIAS" \
  --message "$DETAIL" \
  --keep-vars
