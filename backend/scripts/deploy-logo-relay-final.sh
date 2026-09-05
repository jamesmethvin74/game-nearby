#!/usr/bin/env bash
set -euo pipefail

npm run check

WORKER_NAME="localbleachersar-sports-api"
PROD_API="https://${WORKER_NAME}.james-methvin74.workers.dev"
TMPDIR="$(mktemp -d)"
MARKER="src/_logo-relay-final-marker.mjs"
trap 'rm -f "$MARKER"; rm -rf "$TMPDIR"' EXIT

wrangler deploy

API_JSON="$TMPDIR/api.json"
RELAY_ACTIVE=0
for ATTEMPT in $(seq 1 15); do
  if curl -fsS --max-time 30 -H 'accept: application/json' -H 'cache-control: no-store' -H 'x-localbleachers-diagnostic: 1' "$PROD_API/api/v1/schools" -o "$API_JSON"; then
    if node - "$API_JSON" <<'NODE'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const u=(p.schools||[]).find(x=>x.id==='uark');process.exit(String(u?.logo_url||'').includes('/api/v1/logo-relay/uark')?0:1);
NODE
    then
      RELAY_ACTIVE=1
      echo "LOGO_RELAY_PRODUCTION_READY attempt=$ATTEMPT"
      break
    fi
  fi
  sleep 2
done

SQL="SELECT id,name,level FROM schools WHERE catalog_scope='local' AND ((level='college' AND id<>'asu-three-rivers') OR (level='high-school' AND id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp'))) ORDER BY CASE WHEN level='high-school' THEN 0 ELSE 1 END,name,id"
D1_JSON="$TMPDIR/d1.json"
REPORT_JSON="$TMPDIR/report.json"
wrangler d1 execute localbleachersar-sports --remote --command="$SQL" --json > "$D1_JSON"
curl -fsS --max-time 30 -H 'accept: application/json' -H 'cache-control: no-store' -H 'x-localbleachers-diagnostic: 1' "$PROD_API/api/v1/schools" -o "$API_JSON"

node - "$D1_JSON" "$API_JSON" "$REPORT_JSON" "$RELAY_ACTIVE" <<'NODE'
const fs=require('fs');
(async()=>{
  const d1=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const api=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  const out=process.argv[4];
  const relayActive=process.argv[5]==='1';
  const envelopes=Array.isArray(d1)?d1:[d1];
  const rows=envelopes.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
  const high=rows.filter(x=>x.level==='high-school');
  const college=rows.filter(x=>x.level==='college');
  if(rows.length!==335||high.length!==300||college.length!==35) throw new Error(`supported universe ${rows.length}/${high.length}/${college.length}`);
  const apiRows=Array.isArray(api?.schools)?api.schools:[];
  const byId=new Map(apiRows.map(x=>[String(x.id),x]));
  const clean=v=>String(v??'').trim();
  const https=v=>{try{return new URL(clean(v)).protocol==='https:'}catch{return false}};
  async function probe(url){
    url=clean(url);if(!url||!https(url))return {ok:false,reason:'blank-or-nonhttps'};
    const c=new AbortController(),t=setTimeout(()=>c.abort(),8000);
    try{
      const r=await fetch(url,{method:'GET',redirect:'follow',signal:c.signal,headers:{accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','user-agent':'Mozilla/5.0 LocalBleachersAR final logo proof'}});
      const ct=clean(r.headers.get('content-type')).toLowerCase();
      try{await r.body?.cancel?.()}catch{}
      return r.ok&&ct.startsWith('image/')?{ok:true,status:r.status,contentType:ct}:{ok:false,reason:r.ok?`non-image:${ct||'missing'}`:`http-${r.status}`};
    }catch(e){return {ok:false,reason:`fetch:${String(e?.name||e?.message||e)}`};}finally{clearTimeout(t)}
  }
  let cursor=0;const audited=new Array(rows.length);
  async function worker(){while(true){const i=cursor++;if(i>=rows.length)return;const row=rows[i],a=byId.get(String(row.id)),url=clean(a?.logo_url),p=await probe(url);audited[i]={id:String(row.id),name:String(row.name),level:String(row.level),logoUrl:url||null,relay:url.includes('/api/v1/logo-relay/'),ok:Boolean(a&&url&&https(url)&&p.ok),reason:p.ok?null:(a?p.reason:'missing-api')};}}
  await Promise.all(Array.from({length:60},()=>worker()));
  const failures=audited.filter(x=>!x.ok);
  const unsupported=apiRows.some(x=>String(x.id)==='asu-three-rivers');
  const report={total:335,highSchools:300,colleges:35,renderable:335-failures.length,fallback:failures.length,relayActive,unsupportedThreeRivers:unsupported,failures,relayed:audited.filter(x=>x.relay).map(x=>x.id)};
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  console.log(`LOGO_RELAY_FINAL renderable=${report.renderable} fallback=${report.fallback} relayed=${report.relayed.length} relayActive=${relayActive} threeRivers=${unsupported}`);
  for(const f of failures)console.log(`LOGO_RELAY_FAILURE ${f.level} ${f.id} ${f.name} ${f.reason||''}`);
})().catch(error=>{console.error(error);process.exit(1)});
NODE

ALIAS="$(node - "$REPORT_JSON" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(Number(p.fallback||0)===0&&p.relayActive&&!p.unsupportedThreeRivers){console.log('logo335-ok');process.exit(0)}
const code={'df-6blldr':'a','aaa-ptzw9n':'b','asu-mid-south':'c','asu-mountain-home':'d','asu-newport':'e','cbc':'f','champion-christian':'g','philander-smith':'h','shorter':'i','south-arkansas':'j','sau-tech':'k','uark':'l','ua-cossatot':'m'};
const tokens=(p.failures||[]).map(x=>code[x.id]||'x').join('');
const flags=`${p.relayActive?'':'s'}${p.unsupportedThreeRivers?'t':''}`;
console.log(`logo335-f${p.fallback||0}-${tokens}${flags}`.slice(0,32));
NODE
)"

cat > "$MARKER" <<'NODE'
export default {fetch(){return new Response('final logo proof marker',{headers:{'cache-control':'no-store'}})}};
NODE
wrangler versions upload "$MARKER" --preview-alias "$ALIAS" --keep-vars

echo "FINAL_LOGO_ALIAS=$ALIAS"
node - "$REPORT_JSON" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(`FINAL_LOGO_PROOF ${p.renderable}/335 fallback=${p.fallback} relayed=${p.relayed.length} relayActive=${p.relayActive} threeRivers=${p.unsupportedThreeRivers}`);
NODE
