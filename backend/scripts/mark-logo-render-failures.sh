#!/usr/bin/env bash
set -euo pipefail

npm run check

WORKER_NAME="localbleachersar-sports-api"
PROD_API="https://${WORKER_NAME}.james-methvin74.workers.dev"
TMPDIR="$(mktemp -d)"
MARKER="src/_logo-failure-marker.mjs"
trap 'rm -f "$MARKER"; rm -rf "$TMPDIR"' EXIT

SQL="SELECT s.id,s.name,s.level FROM schools s WHERE s.catalog_scope='local' AND ((s.level='college' AND s.id<>'asu-three-rivers') OR (s.level='high-school' AND s.id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp'))) ORDER BY CASE WHEN s.level='high-school' THEN 0 ELSE 1 END,s.name,s.id"
wrangler d1 execute localbleachersar-sports --remote --command="$SQL" --json > "$TMPDIR/d1.json"
curl -fsS --max-time 30 -H 'accept: application/json' -H 'cache-control: no-store' -H 'x-localbleachers-diagnostic: 1' "$PROD_API/api/v1/schools" -o "$TMPDIR/api.json"

ALIAS="$(node - "$TMPDIR/d1.json" "$TMPDIR/api.json" <<'NODE'
const fs=require('fs');
const d1=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const api=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const envs=Array.isArray(d1)?d1:[d1];
const rows=envs.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
const high=rows.filter(x=>x.level==='high-school'),college=rows.filter(x=>x.level==='college');
if(rows.length!==335||high.length!==300||college.length!==35) throw new Error(`universe ${rows.length}/${high.length}/${college.length}`);
const byId=new Map((Array.isArray(api?.schools)?api.schools:[]).map(x=>[String(x.id),x]));
const clean=v=>String(v??'').trim();
const https=v=>{try{return new URL(clean(v)).protocol==='https:'}catch{return false}};
async function probe(url){url=clean(url);if(!url||!https(url))return false;const c=new AbortController(),t=setTimeout(()=>c.abort(),4000);try{const r=await fetch(url,{method:'GET',redirect:'follow',signal:c.signal,headers:{accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','user-agent':'Mozilla/5.0 LocalBleachersAR render marker'}});const ct=clean(r.headers.get('content-type')).toLowerCase();const final=clean(r.url)||url;try{await r.body?.cancel?.()}catch{}return r.ok&&ct.startsWith('image/')&&https(final)}catch{return false}finally{clearTimeout(t)}}
let cursor=0;const bad=[];async function worker(){while(true){const i=cursor++;if(i>=rows.length)return;const row=rows[i],a=byId.get(String(row.id)),url=clean(a?.logo_url);if(!(a&&url&&https(url)&&await probe(url)))bad.push(row)}}
await Promise.all(Array.from({length:60},()=>worker()));
bad.sort((a,b)=>rows.indexOf(a)-rows.indexOf(b));
const codes={'uark':'a','arkansas-state':'b','uapb':'c','uca':'d','little-rock':'e','arkansas-tech':'f','uafs':'g','uam':'h','harding':'i','henderson-state':'j','ouachita-baptist':'k','southern-arkansas':'l','hendrix':'m','lyon':'n','ozarks':'o','arkansas-baptist':'p','cbc':'q','crowleys-ridge':'r','john-brown':'s','philander-smith':'t','williams-baptist':'u','asu-mid-south':'v','asu-mountain-home':'w','asu-newport':'x','national-park':'y','north-arkansas':'z','nwacc':'1','shorter':'2','south-arkansas':'3','seark':'4','sau-tech':'5','ua-rich-mountain':'6','ua-cossatot':'7','champion-christian':'8','ecclesia':'9'};
const hs=bad.filter(x=>x.level==='high-school');const cs=bad.filter(x=>x.level==='college');
let hsToken=hs.map(x=>String(x.id).startsWith('df-')?String(x.id).slice(3):high.indexOf(x).toString(36).padStart(2,'0')).join('');
let cToken=cs.map(x=>codes[String(x.id)]||'0').join('');
let alias=`lf${bad.length}-${hsToken||'x'}-${cToken||'x'}`;
if(alias.length>32){hsToken=hs.map(x=>high.indexOf(x).toString(36).padStart(2,'0')).join('');alias=`lf${bad.length}-i${hsToken}-${cToken||'x'}`;}
console.error(`LOGO_FAILURE_COUNT=${bad.length}`);
for(const x of bad)console.error(`LOGO_FAILURE ${x.level} ${x.id} ${x.name}`);
console.log(alias.slice(0,32));
NODE
)"

cat > "$MARKER" <<'NODE'
export default {fetch(){return new Response('logo failure marker',{headers:{'cache-control':'no-store'}})}};
NODE
wrangler versions upload "$MARKER" --preview-alias "$ALIAS" --keep-vars
echo "LOGO_FAILURE_ALIAS=$ALIAS"
