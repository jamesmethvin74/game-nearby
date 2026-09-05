#!/usr/bin/env bash
set -euo pipefail

npm run check

WORKER_NAME="localbleachersar-sports-api"
EXEC_ALIAS="logo-render-final-exec"
EXEC_API="https://${EXEC_ALIAS}-${WORKER_NAME}.james-methvin74.workers.dev"
PROD_API="https://${WORKER_NAME}.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/final-logo-render/ready"
HS_PATH="/api/v1/content/final-logo-render/high-school"
COLLEGE_PATH="/api/v1/content/final-logo-render/college"
EXEC_WRAPPER="src/_final-logo-exec.mjs"
RESULT_WRAPPER="src/_final-logo-result.mjs"
TMPDIR="$(mktemp -d)"
TOKEN=""
KEEP_RESULT=0

cleanup() {
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
process.stdout.write(`import app from "./final-logo-render-worker.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction withToken(env){const wrapped=Object.create(env);Object.defineProperty(wrapped,"FINAL_LOGO_TOKEN",{value:TOKEN,enumerable:true});return wrapped;}\nexport default {fetch(request,env,ctx){return app.fetch(request,withToken(env),ctx);}};\n`);
NODE

wrangler versions upload "$EXEC_WRAPPER" --preview-alias "$EXEC_ALIAS" --keep-vars

READY_STATUS=""
for ATTEMPT in $(seq 1 15); do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --head -H "x-final-logo-token: $TOKEN" -H 'cache-control: no-store' "$EXEC_API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then echo "FINAL_LOGO_READY attempt=$ATTEMPT"; break; fi
  sleep 2
done
if [ "$READY_STATUS" != "204" ]; then echo "Final logo preview readiness never reached 204" >&2; exit 1; fi

VISIBLE_SQL="SELECT
  s.id,s.name,s.level,s.logo_url AS school_logo_url,
  b.logo_url AS brand_logo_url,b.provider AS brand_provider,b.source_url AS brand_source_url,b.status AS brand_status
FROM schools s
LEFT JOIN school_brand_assets b ON b.school_id=s.id
WHERE s.catalog_scope='local' AND (
  (s.level='college' AND s.id <> 'asu-three-rivers')
  OR
  (s.level='high-school' AND s.id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp'))
)
ORDER BY CASE WHEN s.level='high-school' THEN 0 ELSE 1 END,s.name,s.id"

PRE_API="$TMPDIR/pre-api.json"
PRE_REPORT="$TMPDIR/pre-report.json"
RECHECK_API="$TMPDIR/recheck-api.json"
RECHECK_REPORT="$TMPDIR/recheck-report.json"
POST_D1="$TMPDIR/post-d1.json"
POST_API="$TMPDIR/post-api.json"
FINAL_AUDIT="$TMPDIR/final-audit.json"
FINAL_REPORT="$TMPDIR/final-report.json"
AUDIT_JS="$TMPDIR/audit.mjs"

cat > "$AUDIT_JS" <<'NODE'
import fs from 'node:fs';
const [apiPath,outPath,mode]=process.argv.slice(2);
const apiPayload=JSON.parse(fs.readFileSync(apiPath,'utf8'));
const excludedHigh=new Set(['df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp']);
const apiSchools=Array.isArray(apiPayload?.schools)?apiPayload.schools:[];
if(apiSchools.some(x=>String(x.id)==='asu-three-rivers')) throw new Error('ASU Three Rivers is exposed by the school API');
const rows=apiSchools.filter(x=>(x.level==='college'&&String(x.id)!=='asu-three-rivers')||(x.level==='high-school'&&!excludedHigh.has(String(x.id))));
const high=rows.filter(x=>x.level==='high-school'),college=rows.filter(x=>x.level==='college');
if(rows.length!==335||high.length!==300||college.length!==35) throw new Error(`Supported API universe mismatch total=${rows.length} high=${high.length} college=${college.length}`);
function clean(v){return String(v??'').trim();}
function https(v){try{return new URL(clean(v)).protocol==='https:';}catch{return false;}}
async function probe(url){
  const raw=clean(url); if(!raw)return{ok:false,reason:'blank-url'}; if(!https(raw))return{ok:false,reason:'not-https'};
  const c=new AbortController(),t=setTimeout(()=>c.abort(),4000);
  try{
    const r=await fetch(raw,{method:'GET',redirect:'follow',signal:c.signal,headers:{accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','user-agent':'Mozilla/5.0 LocalBleachersAR render audit'}});
    const ct=clean(r.headers.get('content-type')).toLowerCase(),finalUrl=clean(r.url)||raw;
    try{await r.body?.cancel?.();}catch{}
    if(r.ok&&ct.startsWith('image/')&&https(finalUrl))return{ok:true,status:r.status,contentType:ct,finalUrl};
    return{ok:false,reason:r.ok?`non-image:${ct||'missing'}`:`http-${r.status}`};
  }catch(e){return{ok:false,reason:`fetch:${String(e?.name||e?.message||e)}`};}finally{clearTimeout(t);}
}
let cursor=0;const audited=new Array(rows.length);
async function worker(){while(true){const i=cursor++;if(i>=rows.length)return;const row=rows[i],url=clean(row.logo_url),p=await probe(url),reasons=[];if(!url)reasons.push('blank-api-logo');if(url&&!https(url))reasons.push('not-https');if(url&&!p.ok)reasons.push(p.reason||'unreachable');audited[i]={schoolId:String(row.id),schoolName:String(row.name),level:String(row.level),apiLogoUrl:url||null,appWouldRender:Boolean(url&&https(url)&&p.ok),failureReasons:reasons};}}
await Promise.all(Array.from({length:60},()=>worker()));
const failures=audited.filter(x=>!x.appWouldRender),hsFailures=failures.filter(x=>x.level==='high-school'),collegeFailures=failures.filter(x=>x.level==='college'),forced=mode==='pre'?['asu-mid-south','asu-mountain-home','asu-newport']:[];
const report={mode,total:335,highSchools:300,colleges:35,appRenderable:335-failures.length,appFallback:failures.length,highSchoolFallback:hsFailures.length,collegeFallback:collegeFailures.length,highSchoolTargets:[...new Set(hsFailures.map(x=>x.schoolId))].sort(),collegeTargets:[...new Set([...collegeFailures.map(x=>x.schoolId),...forced])].sort(),failures:failures.map(x=>({schoolId:x.schoolId,schoolName:x.schoolName,level:x.level,reasons:x.failureReasons})),schools:audited};
fs.writeFileSync(outPath,JSON.stringify(report,null,2));console.log(`FINAL_LOGO_AUDIT mode=${mode} appRenderable=${report.appRenderable} appFallback=${report.appFallback} hsFallback=${report.highSchoolFallback} collegeFallback=${report.collegeFallback}`);
NODE

fetch_api(){ curl -fsS --max-time 30 -H 'accept: application/json' -H 'cache-control: no-store' -H 'x-localbleachers-diagnostic: 1' "$1/api/v1/schools" -o "$2"; }
write_targets(){ node - "$1" "$2" > "$3" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));for(const id of p[process.argv[3]]||[])console.log(id);
NODE
}
repair_file(){
  local ids_file="$1" limit="$2" path="$3" tag="$4"; mapfile -t IDS < "$ids_file"; local count="${#IDS[@]}";
  if [ "$count" -eq 0 ]; then echo "${tag}_NO_TARGETS"; return 0; fi
  for ((OFFSET=0; OFFSET<count; OFFSET+=limit)); do
    CHUNK=("${IDS[@]:OFFSET:limit}"); BODY="$(printf '%s\n' "${CHUNK[@]}"|node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({schoolIds:s.trim().split(/\s+/).filter(Boolean)})))')"; OUT="$TMPDIR/${tag}-${OFFSET}.json";
    CODE="$(curl -sS --max-time 90 -o "$OUT" -w '%{http_code}' -X POST -H 'accept: application/json' -H 'content-type: application/json' -H 'cache-control: no-store' -H "x-final-logo-token: $TOKEN" --data "$BODY" "$EXEC_API$path" || true)";
    if [ "$CODE" != "200" ]; then echo "${tag}_HTTP_FAILURE offset=$OFFSET code=${CODE:-curl_error}"; cat "$OUT" 2>/dev/null||true; continue; fi
    node - "$OUT" "$tag" "$OFFSET" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(`${process.argv[3]}_BATCH offset=${process.argv[4]} status=${p.status||''} attempted=${Number(p.attempted||0)} written=${Number(p.written||0)} failures=${Array.isArray(p.failures)?p.failures.length:0} rowsRead=${Number(p.rowsRead||0)} rowsWritten=${Number(p.rowsWritten||0)}`);
NODE
  done
}

HS_TARGETS="$TMPDIR/hs-targets.txt"; COLLEGE_TARGETS="$TMPDIR/college-targets.txt"
fetch_api "$EXEC_API" "$PRE_API"; node "$AUDIT_JS" "$PRE_API" "$PRE_REPORT" pre
write_targets "$PRE_REPORT" highSchoolTargets "$HS_TARGETS"; write_targets "$PRE_REPORT" collegeTargets "$COLLEGE_TARGETS"
repair_file "$HS_TARGETS" 25 "$HS_PATH" HS_REPAIR1; repair_file "$COLLEGE_TARGETS" 8 "$COLLEGE_PATH" COLLEGE_REPAIR1

fetch_api "$EXEC_API" "$RECHECK_API"; node "$AUDIT_JS" "$RECHECK_API" "$RECHECK_REPORT" recheck
write_targets "$RECHECK_REPORT" highSchoolTargets "$HS_TARGETS"; write_targets "$RECHECK_REPORT" collegeTargets "$COLLEGE_TARGETS"
repair_file "$HS_TARGETS" 25 "$HS_PATH" HS_REPAIR2; repair_file "$COLLEGE_TARGETS" 8 "$COLLEGE_PATH" COLLEGE_REPAIR2

wrangler deploy
PROD_READY=0
for ATTEMPT in $(seq 1 12); do
  if fetch_api "$PROD_API" "$POST_API" && node - "$POST_API" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),e=new Set(['df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp']),r=Array.isArray(p.schools)?p.schools:[],h=r.filter(x=>x.level==='high-school'&&!e.has(String(x.id))),c=r.filter(x=>x.level==='college'&&x.id!=='asu-three-rivers');process.exit(!r.some(x=>x.id==='asu-three-rivers')&&h.length===300&&c.length===35?0:1);
NODE
  then PROD_READY=1;echo "FINAL_LOGO_PRODUCTION_READY attempt=$ATTEMPT";break;fi;sleep 2;done
if [ "$PROD_READY" != "1" ]; then echo "Production school API did not converge to 300+35" >&2;exit 1;fi

# One and only one broad D1 verification, after repair.
wrangler d1 execute localbleachersar-sports --remote --command="$VISIBLE_SQL" --json > "$POST_D1"
fetch_api "$PROD_API" "$POST_API"; node "$AUDIT_JS" "$POST_API" "$FINAL_AUDIT" final
node - "$FINAL_AUDIT" "$POST_D1" "$FINAL_REPORT" <<'NODE'
const fs=require('fs'),a=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),d=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),e=Array.isArray(d)?d:[d],rows=e.flatMap(x=>Array.isArray(x?.results)?x.results:[]);if(rows.length!==335)throw new Error(`Final D1 universe mismatch ${rows.length}`);const m=new Map(rows.map(x=>[String(x.id),x]));a.schools=a.schools.map(x=>{const r=m.get(x.schoolId)||{};return{...x,storedSchoolLogoUrl:String(r.school_logo_url||'').trim()||null,storedBrandLogoUrl:String(r.brand_logo_url||'').trim()||null,brandProvider:String(r.brand_provider||'').trim()||null,brandSourceUrl:String(r.brand_source_url||'').trim()||null,brandStatus:String(r.brand_status||'').trim()||null};});a.d1Meta={rowsRead:e.reduce((n,x)=>n+Number(x?.meta?.rows_read||x?.meta?.rowsRead||0),0),rowsWritten:e.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0)};fs.writeFileSync(process.argv[4],JSON.stringify(a,null,2));
NODE

ALIAS="$(node - "$FINAL_REPORT" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(Number(p.appFallback||0)===0){console.log('logo335-ok');process.exit(0);}const hs=(p.schools||[]).filter(x=>x.level==='high-school').map(x=>x.schoolId),c={'uark':'a','arkansas-state':'b','uapb':'c','uca':'d','little-rock':'e','arkansas-tech':'f','uafs':'g','uam':'h','harding':'i','henderson-state':'j','ouachita-baptist':'k','southern-arkansas':'l','hendrix':'m','lyon':'n','ozarks':'o','arkansas-baptist':'p','cbc':'q','crowleys-ridge':'r','john-brown':'s','philander-smith':'t','williams-baptist':'u','asu-mid-south':'v','asu-mountain-home':'w','asu-newport':'x','national-park':'y','north-arkansas':'z','nwacc':'1','shorter':'2','south-arkansas':'3','seark':'4','sau-tech':'5','ua-rich-mountain':'6','ua-cossatot':'7','champion-christian':'8','ecclesia':'9'},t=[];for(const f of p.failures||[]){if(f.level==='college')t.push(`c${c[f.schoolId]||'0'}`);else t.push(`h${Math.max(0,hs.indexOf(f.schoolId)).toString(36).padStart(2,'0')}`);}console.log(`logo335-f${Number(p.appFallback||0)}-${t.join('')}`.slice(0,32));
NODE
)"
node - "$FINAL_REPORT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs'),result=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));process.stdout.write(`const RESULT=${JSON.stringify(result)};\nexport default {fetch(request){if(new URL(request.url).pathname==="/final-logo-result")return Response.json(RESULT,{headers:{"cache-control":"no-store"}});return new Response("Not found",{status:404});}};\n`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars
KEEP_RESULT=1
echo "FINAL_LOGO_RESULT_ALIAS=$ALIAS"
echo "FINAL_LOGO_RESULT_URL=https://${ALIAS}-${WORKER_NAME}.james-methvin74.workers.dev/final-logo-result"
node - "$FINAL_REPORT" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(`FINAL_LOGO_COMPLETE appRenderable=${p.appRenderable} appFallback=${p.appFallback} highSchoolFallback=${p.highSchoolFallback} collegeFallback=${p.collegeFallback} d1RowsRead=${Number(p.d1Meta?.rowsRead||0)} d1RowsWritten=${Number(p.d1Meta?.rowsWritten||0)}`);for(const f of p.failures||[])console.log(`FINAL_LOGO_FAILURE ${f.level} ${f.schoolId} ${f.schoolName} ${f.reasons.join(',')}`);
NODE
