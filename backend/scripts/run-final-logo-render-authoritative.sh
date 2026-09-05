#!/usr/bin/env bash
set -euo pipefail

npm run check

WORKER_NAME="localbleachersar-sports-api"
EXEC_ALIAS="logo-render-auth-exec"
EXEC_API="https://${EXEC_ALIAS}-${WORKER_NAME}.james-methvin74.workers.dev"
PROD_API="https://${WORKER_NAME}.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/final-logo-render/ready"
HS_PATH="/api/v1/content/final-logo-render/high-school"
COLLEGE_PATH="/api/v1/content/final-logo-render/college"
EXEC_WRAPPER="src/_logo-auth-exec.mjs"
RESULT_WRAPPER="src/_logo-auth-result.mjs"
TMPDIR="$(mktemp -d)"
KEEP_RESULT=0

cleanup(){
  if [ "$KEEP_RESULT" != "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$EXEC_ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$EXEC_WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
node - "$TOKEN" > "$EXEC_WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import app from "./final-logo-render-worker.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction envWithToken(env){const e=Object.create(env);Object.defineProperty(e,"FINAL_LOGO_TOKEN",{value:TOKEN,enumerable:true});return e;}\nexport default {fetch(req,env,ctx){return app.fetch(req,envWithToken(env),ctx);}};\n`);
NODE

wrangler versions upload "$EXEC_WRAPPER" --preview-alias "$EXEC_ALIAS" --keep-vars
READY=""
for N in $(seq 1 15); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --head -H "x-final-logo-token: $TOKEN" "$EXEC_API$READY_PATH" || true)"
  [ "$READY" = "204" ] && { echo "LOGO_AUTH_READY attempt=$N"; break; }
  sleep 2
done
[ "$READY" = "204" ] || { echo "preview readiness failed" >&2; exit 1; }

VISIBLE_SQL="SELECT s.id,s.name,s.level,s.logo_url AS school_logo_url,b.logo_url AS brand_logo_url,b.provider AS brand_provider,b.source_url AS brand_source_url,b.status AS brand_status FROM schools s LEFT JOIN school_brand_assets b ON b.school_id=s.id WHERE s.catalog_scope='local' AND ((s.level='college' AND s.id<>'asu-three-rivers') OR (s.level='high-school' AND s.id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp'))) ORDER BY CASE WHEN s.level='high-school' THEN 0 ELSE 1 END,s.name,s.id"
PRE_D1="$TMPDIR/pre-d1.json"; POST_D1="$TMPDIR/post-d1.json"
PRE_API="$TMPDIR/pre-api.json"; MID_API="$TMPDIR/mid-api.json"; POST_API="$TMPDIR/post-api.json"
PRE_REPORT="$TMPDIR/pre-report.json"; MID_REPORT="$TMPDIR/mid-report.json"; FINAL_REPORT="$TMPDIR/final-report.json"
AUDIT_JS="$TMPDIR/audit.mjs"

# Authoritative supported-school denominator. This is a single 335-row read.
wrangler d1 execute localbleachersar-sports --remote --command="$VISIBLE_SQL" --json > "$PRE_D1"

cat > "$AUDIT_JS" <<'NODE'
import fs from 'node:fs';
const [d1Path,apiPath,outPath,mode]=process.argv.slice(2);
const d1=JSON.parse(fs.readFileSync(d1Path,'utf8'));
const api=JSON.parse(fs.readFileSync(apiPath,'utf8'));
const envs=Array.isArray(d1)?d1:[d1];
const rows=envs.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
const high=rows.filter(x=>x.level==='high-school'),college=rows.filter(x=>x.level==='college');
if(rows.length!==335||high.length!==300||college.length!==35) throw new Error(`D1 universe mismatch total=${rows.length} high=${high.length} college=${college.length}`);
const apiRows=Array.isArray(api?.schools)?api.schools:[];
const apiById=new Map(apiRows.map(x=>[String(x.id),x]));
const unsupportedExposed=apiRows.filter(x=>String(x.id)==='asu-three-rivers').map(x=>String(x.id));
function clean(v){return String(v??'').trim();}
function https(v){try{return new URL(clean(v)).protocol==='https:';}catch{return false;}}
async function probe(raw){
  raw=clean(raw); if(!raw)return{ok:false,reason:'blank-url'}; if(!https(raw))return{ok:false,reason:'not-https'};
  const c=new AbortController(),t=setTimeout(()=>c.abort(),4000);
  try{
    const r=await fetch(raw,{method:'GET',redirect:'follow',signal:c.signal,headers:{accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','user-agent':'Mozilla/5.0 LocalBleachersAR render audit'}});
    const ct=clean(r.headers.get('content-type')).toLowerCase(),finalUrl=clean(r.url)||raw;
    try{await r.body?.cancel?.();}catch{}
    return r.ok&&ct.startsWith('image/')&&https(finalUrl)?{ok:true}:{ok:false,reason:r.ok?`non-image:${ct||'missing'}`:`http-${r.status}`};
  }catch(e){return{ok:false,reason:`fetch:${String(e?.name||e?.message||e)}`};}finally{clearTimeout(t);}
}
let cursor=0;const audited=new Array(rows.length);
async function worker(){while(true){const i=cursor++;if(i>=rows.length)return;const d=rows[i],a=apiById.get(String(d.id)),url=clean(a?.logo_url),p=await probe(url),reasons=[];if(!a)reasons.push('missing-api');if(!url)reasons.push('blank-api-logo');if(url&&!https(url))reasons.push('not-https');if(url&&!p.ok)reasons.push(p.reason||'unreachable');audited[i]={schoolId:String(d.id),schoolName:String(d.name),level:String(d.level),storedSchoolLogoUrl:clean(d.school_logo_url)||null,storedBrandLogoUrl:clean(d.brand_logo_url)||null,brandProvider:clean(d.brand_provider)||null,brandSourceUrl:clean(d.brand_source_url)||null,brandStatus:clean(d.brand_status)||null,apiLogoUrl:url||null,appWouldRender:Boolean(a&&url&&https(url)&&p.ok),failureReasons:reasons};}}
await Promise.all(Array.from({length:60},()=>worker()));
const failures=audited.filter(x=>!x.appWouldRender),hs=failures.filter(x=>x.level==='high-school'),cs=failures.filter(x=>x.level==='college'),forced=mode==='pre'?['asu-mid-south','asu-mountain-home','asu-newport']:[];
const report={mode,total:335,highSchools:300,colleges:35,appRenderable:335-failures.length,appFallback:failures.length,highSchoolFallback:hs.length,collegeFallback:cs.length,unsupportedExposed,highSchoolTargets:[...new Set(hs.map(x=>x.schoolId))].sort(),collegeTargets:[...new Set([...cs.map(x=>x.schoolId),...forced])].sort(),failures:failures.map(x=>({schoolId:x.schoolId,schoolName:x.schoolName,level:x.level,reasons:x.failureReasons})),schools:audited,d1Meta:{rowsRead:envs.reduce((n,x)=>n+Number(x?.meta?.rows_read||x?.meta?.rowsRead||0),0),rowsWritten:envs.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0)}};
fs.writeFileSync(outPath,JSON.stringify(report,null,2));
console.log(`LOGO_AUTH_AUDIT mode=${mode} render=${report.appRenderable} fallback=${report.appFallback} hs=${report.highSchoolFallback} college=${report.collegeFallback} unsupported=${unsupportedExposed.length}`);
NODE

fetch_api(){ curl -fsS --max-time 30 -H 'accept: application/json' -H 'cache-control: no-store' -H 'x-localbleachers-diagnostic: 1' "$1/api/v1/schools" -o "$2"; }
write_targets(){ node - "$1" "$2" > "$3" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));for(const id of p[process.argv[3]]||[])console.log(id);
NODE
}
repair(){
  local ids="$1" limit="$2" path="$3" tag="$4"; mapfile -t A < "$ids"; local count="${#A[@]}"; [ "$count" -gt 0 ]||{ echo "${tag}_NO_TARGETS"; return 0; };
  for((o=0;o<count;o+=limit));do
    C=("${A[@]:o:limit}"); BODY="$(printf '%s\n' "${C[@]}"|node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({schoolIds:s.trim().split(/\s+/).filter(Boolean)})))')"; OUT="$TMPDIR/${tag}-$o.json";
    CODE="$(curl -sS --max-time 90 -o "$OUT" -w '%{http_code}' -X POST -H 'content-type: application/json' -H "x-final-logo-token: $TOKEN" --data "$BODY" "$EXEC_API$path" || true)";
    if [ "$CODE" != "200" ];then echo "${tag}_HTTP_FAIL offset=$o code=${CODE:-curl_error}";continue;fi
    node - "$OUT" "$tag" "$o" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(`${process.argv[3]} offset=${process.argv[4]} attempted=${p.attempted||0} written=${p.written||0} failures=${Array.isArray(p.failures)?p.failures.length:0} rowsRead=${p.rowsRead||0} rowsWritten=${p.rowsWritten||0}`);
NODE
  done
}

HS="$TMPDIR/hs.txt"; COL="$TMPDIR/college.txt"
fetch_api "$EXEC_API" "$PRE_API"; node "$AUDIT_JS" "$PRE_D1" "$PRE_API" "$PRE_REPORT" pre
write_targets "$PRE_REPORT" highSchoolTargets "$HS"; write_targets "$PRE_REPORT" collegeTargets "$COL"
repair "$HS" 25 "$HS_PATH" HS1; repair "$COL" 8 "$COLLEGE_PATH" COL1

# Recheck against the same authoritative IDs; their stored URLs are not needed to select remaining failures.
fetch_api "$EXEC_API" "$MID_API"; node "$AUDIT_JS" "$PRE_D1" "$MID_API" "$MID_REPORT" mid
write_targets "$MID_REPORT" highSchoolTargets "$HS"; write_targets "$MID_REPORT" collegeTargets "$COL"
repair "$HS" 25 "$HS_PATH" HS2; repair "$COL" 8 "$COLLEGE_PATH" COL2

# Deploy API brand overlay/cache generation after targeted repairs.
wrangler deploy
for N in $(seq 1 12);do fetch_api "$PROD_API" "$POST_API"&&break||sleep 2;done

# One final authoritative D1 read + production app-render probe.
wrangler d1 execute localbleachersar-sports --remote --command="$VISIBLE_SQL" --json > "$POST_D1"
fetch_api "$PROD_API" "$POST_API"
node "$AUDIT_JS" "$POST_D1" "$POST_API" "$FINAL_REPORT" final

ALIAS="$(node - "$FINAL_REPORT" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(Number(p.appFallback||0)===0&&!(p.unsupportedExposed||[]).length){console.log('logo335-ok');process.exit(0);}const hs=(p.schools||[]).filter(x=>x.level==='high-school').map(x=>x.schoolId),c={'uark':'a','arkansas-state':'b','uapb':'c','uca':'d','little-rock':'e','arkansas-tech':'f','uafs':'g','uam':'h','harding':'i','henderson-state':'j','ouachita-baptist':'k','southern-arkansas':'l','hendrix':'m','lyon':'n','ozarks':'o','arkansas-baptist':'p','cbc':'q','crowleys-ridge':'r','john-brown':'s','philander-smith':'t','williams-baptist':'u','asu-mid-south':'v','asu-mountain-home':'w','asu-newport':'x','national-park':'y','north-arkansas':'z','nwacc':'1','shorter':'2','south-arkansas':'3','seark':'4','sau-tech':'5','ua-rich-mountain':'6','ua-cossatot':'7','champion-christian':'8','ecclesia':'9'},t=[];for(const f of p.failures||[]){t.push(f.level==='college'?`c${c[f.schoolId]||'0'}`:`h${Math.max(0,hs.indexOf(f.schoolId)).toString(36).padStart(2,'0')}`);}if((p.unsupportedExposed||[]).length)t.push('x');console.log(`logo335-f${p.appFallback||0}-${t.join('')}`.slice(0,32));
NODE
)"
node - "$FINAL_REPORT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs'),R=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));process.stdout.write(`const R=${JSON.stringify(R)};export default {fetch(q){return new URL(q.url).pathname==="/final-logo-result"?Response.json(R,{headers:{"cache-control":"no-store"}}):new Response("Not found",{status:404})}};`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars
KEEP_RESULT=1
echo "FINAL_LOGO_RESULT_ALIAS=$ALIAS"
echo "FINAL_LOGO_RESULT_URL=https://${ALIAS}-${WORKER_NAME}.james-methvin74.workers.dev/final-logo-result"
node - "$FINAL_REPORT" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(`FINAL_LOGO_COMPLETE appRenderable=${p.appRenderable} appFallback=${p.appFallback} highSchoolFallback=${p.highSchoolFallback} collegeFallback=${p.collegeFallback} unsupported=${(p.unsupportedExposed||[]).length} d1RowsRead=${p.d1Meta?.rowsRead||0}`);for(const f of p.failures||[])console.log(`FINAL_LOGO_FAILURE ${f.level} ${f.schoolId} ${f.schoolName} ${f.reasons.join(',')}`);
NODE
