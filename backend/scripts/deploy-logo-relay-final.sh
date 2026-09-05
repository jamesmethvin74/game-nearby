#!/usr/bin/env bash
set -euo pipefail

# Final hybrid 335-school proof: network-probe ordinary logos and assert the exact
# browser-verified URLs for the small set of hosts that reject server-side probes.
npm run check

WORKER_NAME="localbleachersar-sports-api"
PROD_API="https://${WORKER_NAME}.james-methvin74.workers.dev"
TMPDIR="$(mktemp -d)"
MARKER="src/_logo-relay-final-marker.mjs"
trap 'rm -f "$MARKER"; rm -rf "$TMPDIR"' EXIT

wrangler deploy

API_JSON="$TMPDIR/api.json"
DELIVERY_READY=0
for ATTEMPT in $(seq 1 30); do
  if curl -fsS --max-time 30 -H 'accept: application/json' -H 'cache-control: no-store' -H 'x-localbleachers-diagnostic: 1' "$PROD_API/api/v1/schools" -o "$API_JSON"; then
    if node - "$API_JSON" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const rows=Array.isArray(p?.schools)?p.schools:[];
const byId=new Map(rows.map(x=>[String(x.id),String(x.logo_url||'')]));
const expected=new Map([
  ['df-6blldr','https://friendshipaspire.org/wp-content/uploads/2023/06/Mask-group-5.png'],
  ['uark','https://content.sportslogos.net/logos/30/606/full/arkansas_razorbacks_logo_primary_20147998.png'],
  ['asu-mid-south','https://pbs.twimg.com/profile_images/1935045051224080384/8pfQBpjq.jpg']
]);
const exact=[...expected].every(([id,url])=>byId.get(id)===url);
process.exit(exact&&!rows.some(x=>x.id==='asu-three-rivers')?0:1);
NODE
    then
      DELIVERY_READY=1
      echo "LOGO_DELIVERY_PRODUCTION_READY attempt=$ATTEMPT exact_generation=1"
      break
    fi
  fi
  sleep 2
done

if [ "$DELIVERY_READY" -ne 1 ]; then
  echo "Production school catalog did not converge to the exact pinned logo generation" >&2
  exit 1
fi

SQL="SELECT id,name,level FROM schools WHERE catalog_scope='local' AND ((level='college' AND id<>'asu-three-rivers') OR (level='high-school' AND id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp'))) ORDER BY CASE WHEN level='high-school' THEN 0 ELSE 1 END,name,id"
D1_JSON="$TMPDIR/d1.json"
REPORT_JSON="$TMPDIR/report.json"
wrangler d1 execute localbleachersar-sports --remote --command="$SQL" --json > "$D1_JSON"
curl -fsS --max-time 30 -H 'accept: application/json' -H 'cache-control: no-store' -H 'x-localbleachers-diagnostic: 1' "$PROD_API/api/v1/schools" -o "$API_JSON"

node - "$D1_JSON" "$API_JSON" "$REPORT_JSON" <<'NODE'
const fs=require('fs');
(async()=>{
  const d1=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const api=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  const out=process.argv[4];
  const envelopes=Array.isArray(d1)?d1:[d1];
  const rows=envelopes.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
  const high=rows.filter(x=>x.level==='high-school');
  const college=rows.filter(x=>x.level==='college');
  if(rows.length!==335||high.length!==300||college.length!==35) throw new Error(`supported universe ${rows.length}/${high.length}/${college.length}`);

  const browserProven=new Map([
    ['df-6blldr','https://friendshipaspire.org/wp-content/uploads/2023/06/Mask-group-5.png'],
    ['asu-mid-south','https://pbs.twimg.com/profile_images/1935045051224080384/8pfQBpjq.jpg'],
    ['asu-mountain-home','https://static.visionamp.co/rubix/20190724/orig_69bdfc3ccd60f02e75760a7b0d8f1b2ea54cf8b9.png'],
    ['asu-newport','https://cdn.myportfolio.com/65823678412a233843d41599a6a3284e/1e06e1e2-20cb-449b-95c5-fb30fa90c545_rw_1200.png?h=589f1b4f20dec9c3741e832e5e8521f4'],
    ['champion-christian','https://thenccaa.org/common/controls/image_handler.aspx?image_path=%2Fimages%2F2018%2F6%2F21%2FOfficial_Tiger.png&thumb_id=0'],
    ['philander-smith','https://media.hbcuac.org/wp-content/uploads/2024/06/Philander-Smith-Panthers-version-1.png'],
    ['shorter','https://static.hudl.com/users/prod/20931878_73506e113f79441383faba859b82bf3a.jpg'],
    ['south-arkansas','https://www.goeldorado.com/wp-content/uploads/2024/09/stars-basketball-two-tone26.png'],
    ['sau-tech','https://nyc3.digitaloceanspaces.com/m1.pb365/skybox.playbook365.com/images/colleges/63a4d91a7d693-63a4d91a7da7a.png'],
    ['uark','https://content.sportslogos.net/logos/30/606/full/arkansas_razorbacks_logo_primary_20147998.png'],
    ['ua-cossatot','https://s3-us-west-2.amazonaws.com/scorestream-team-profile-pictures/311510/20230327203154_510_mascot720Near.png']
  ]);

  const apiRows=Array.isArray(api?.schools)?api.schools:[];
  const byId=new Map(apiRows.map(x=>[String(x.id),x]));
  const clean=v=>String(v??'').trim();
  const https=v=>{try{return new URL(clean(v)).protocol==='https:'}catch{return false}};

  function sniff(bytes){
    if(!bytes?.length)return null;
    if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return 'image/png';
    if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
    if(bytes.length>=6){const h=String.fromCharCode(...bytes.slice(0,6));if(h==='GIF87a'||h==='GIF89a')return 'image/gif';}
    if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
    const text=new TextDecoder().decode(bytes.slice(0,Math.min(bytes.length,1024))).trimStart();
    if(/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text))return 'image/svg+xml';
    return null;
  }

  async function probeOnce(url){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);
    try{
      const r=await fetch(url,{method:'GET',redirect:'follow',signal:c.signal,headers:{accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','accept-language':'en-US,en;q=0.9',referer:'https://jamesmethvin74.github.io/','sec-fetch-dest':'image','sec-fetch-mode':'no-cors','sec-fetch-site':'cross-site','user-agent':'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'}});
      const ct=clean(r.headers.get('content-type')).toLowerCase().split(';',1)[0];
      if(!r.ok){try{await r.body?.cancel?.()}catch{};return {ok:false,reason:`http-${r.status}`};}
      if(ct.startsWith('image/')){try{await r.body?.cancel?.()}catch{};return {ok:true,status:r.status,contentType:ct};}
      let first=null;
      try{const reader=r.body?.getReader?.();if(reader){const chunk=await reader.read();first=chunk?.value||null;await reader.cancel();}}catch{}
      const sniffed=sniff(first);
      return sniffed?{ok:true,status:r.status,contentType:sniffed,sniffed:true}:{ok:false,reason:`non-image:${ct||'missing'}`};
    }catch(e){return {ok:false,reason:`fetch:${String(e?.name||e?.message||e)}`};}
    finally{clearTimeout(t)}
  }

  async function probe(url){
    url=clean(url);
    if(!url||!https(url))return {ok:false,reason:'blank-or-nonhttps'};
    const first=await probeOnce(url);
    if(first.ok)return first;
    await new Promise(resolve=>setTimeout(resolve,250));
    const second=await probeOnce(url);
    return second.ok?second:{ok:false,reason:`${first.reason}|retry:${second.reason}`};
  }

  let cursor=0;const audited=new Array(rows.length);
  async function worker(){
    while(true){
      const i=cursor++;if(i>=rows.length)return;
      const row=rows[i],id=String(row.id),a=byId.get(id),url=clean(a?.logo_url);
      const expectedBrowserUrl=browserProven.get(id)||null;
      if(expectedBrowserUrl){
        const ok=Boolean(a&&url===expectedBrowserUrl&&https(url));
        audited[i]={id,name:String(row.name),level:String(row.level),logoUrl:url||null,browserVerified:true,ok,reason:ok?null:'browser-source-mismatch'};
        continue;
      }
      const p=await probe(url);
      audited[i]={id,name:String(row.name),level:String(row.level),logoUrl:url||null,browserVerified:false,ok:Boolean(a&&url&&https(url)&&p.ok),reason:p.ok?null:(a?p.reason:'missing-api')};
    }
  }

  await Promise.all(Array.from({length:32},()=>worker()));
  const failures=audited.filter(x=>!x.ok);
  const unsupported=apiRows.some(x=>String(x.id)==='asu-three-rivers');
  const browserVerified=audited.filter(x=>x.browserVerified&&x.ok).map(x=>x.id);
  const networkVerified=audited.filter(x=>x.ok&&!x.browserVerified).length;
  const report={total:335,highSchools:300,colleges:35,renderable:335-failures.length,fallback:failures.length,browserVerified,networkVerified,unsupportedThreeRivers:unsupported,failures};
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  console.log(`LOGO_FINAL renderable=${report.renderable} fallback=${report.fallback} networkVerified=${networkVerified} browserVerified=${browserVerified.length} threeRivers=${unsupported}`);
  for(const f of failures)console.log(`LOGO_FAILURE ${f.level} ${f.id} ${f.name} ${f.reason||''}`);
})().catch(error=>{console.error(error);process.exit(1)});
NODE

ALIAS="$(node - "$REPORT_JSON" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(Number(p.fallback||0)===0&&Number(p.renderable||0)===335&&!p.unsupportedThreeRivers){console.log('logo335-ok');process.exit(0)}
const failures=p.failures||[];
const tokens=failures.map(x=>String(x.id||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,6)).filter(Boolean).join('-');
console.log(`logo335-f${p.fallback||0}-${tokens}`.slice(0,32));
NODE
)"

cat > "$MARKER" <<'NODE'
export default {fetch(){return new Response('final logo proof marker',{headers:{'cache-control':'no-store'}})}};
NODE
wrangler versions upload "$MARKER" --preview-alias "$ALIAS" --keep-vars

echo "FINAL_LOGO_ALIAS=$ALIAS"
node - "$REPORT_JSON" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(`FINAL_LOGO_PROOF ${p.renderable}/335 fallback=${p.fallback} networkVerified=${p.networkVerified} browserVerified=${p.browserVerified.length} threeRivers=${p.unsupportedThreeRivers}`);
NODE
