#!/usr/bin/env bash
set -euo pipefail

npm run check

WORKER_NAME="localbleachersar-sports-api"
EXEC_ALIAS="college-logo-finish-exec"
RESULT_ALIAS="college-logo-finish-result"
API="https://${EXEC_ALIAS}-${WORKER_NAME}.james-methvin74.workers.dev"
PROD_API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/content/logo-bootstrap/ready"
COLLEGE_PATH="/api/v1/content/logo-bootstrap/college"
EXEC_WRAPPER="src/_college-logo-finish-exec.mjs"
RESULT_WRAPPER="src/_college-logo-finish-result.mjs"
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
process.stdout.write(`import app from "./logo-bootstrap-worker.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction withToken(env){const wrapped=Object.create(env);Object.defineProperty(wrapped,"LOGO_BOOTSTRAP_TOKEN",{value:TOKEN,enumerable:true});return wrapped;}\nexport default {fetch(request,env,ctx){return app.fetch(request,withToken(env),ctx);}};\n`);
NODE

# Upload an isolated execution version. This does not move production traffic.
wrangler versions upload "$EXEC_WRAPPER" --preview-alias "$EXEC_ALIAS" --keep-vars

READY_STATUS=""
for ATTEMPT in $(seq 1 20); do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-logo-bootstrap-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then
    echo "COLLEGE_LOGO_FINISH_READY attempt=$ATTEMPT"
    break
  fi
  sleep 3
done
if [ "$READY_STATUS" != "204" ]; then
  echo "College logo finish preview readiness never reached 204" >&2
  exit 1
fi

D1_SQL="SELECT
  s.id,s.name,s.logo_url AS school_logo_url,
  b.logo_url AS brand_logo_url,b.provider AS brand_provider,
  b.source_url AS brand_source_url,b.status AS brand_status
FROM schools s
LEFT JOIN school_brand_assets b ON b.school_id=s.id
WHERE s.catalog_scope='local' AND s.level='college'
  AND s.id <> 'asu-three-rivers'
ORDER BY s.name"

PRE_D1="$TMPDIR/pre-d1.json"
PRE_API="$TMPDIR/pre-api.json"
TARGETS_JSON="$TMPDIR/targets.json"

# One bounded read of the 35 supported college rows.
wrangler d1 execute localbleachersar-sports --remote --command="$D1_SQL" --json > "$PRE_D1"
curl -fsS --max-time 45 -H 'accept: application/json' "$PROD_API/api/v1/schools" -o "$PRE_API"

node --input-type=module - "$PRE_D1" "$PRE_API" "$TARGETS_JSON" <<'NODE'
import fs from 'node:fs';
const [d1Path, apiPath, outPath]=process.argv.slice(2);
const d1Payload=JSON.parse(fs.readFileSync(d1Path,'utf8'));
const apiPayload=JSON.parse(fs.readFileSync(apiPath,'utf8'));
const envelopes=Array.isArray(d1Payload)?d1Payload:[d1Payload];
const rows=envelopes.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
if(rows.length!==35) throw new Error(`Expected 35 supported colleges, got ${rows.length}`);
const apiById=new Map((apiPayload?.schools||[]).map(x=>[String(x.id),x]));
function clean(v){return String(v??'').trim();}
function https(v){try{return new URL(clean(v)).protocol==='https:';}catch{return false;}}
async function probe(url){
  const raw=clean(url);
  if(!raw||!https(raw)) return false;
  for(const range of [true,false]){
    const c=new AbortController(); const t=setTimeout(()=>c.abort(),15000);
    try{
      const headers={accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','user-agent':'Mozilla/5.0 LocalBleachersAR logo finish'};
      if(range) headers.range='bytes=0-4095';
      const r=await fetch(raw,{method:'GET',headers,redirect:'follow',signal:c.signal});
      const ct=clean(r.headers.get('content-type')).toLowerCase();
      if(r.ok&&ct.startsWith('image/')) return true;
      if(![403,405,416].includes(r.status)) return false;
    }catch{} finally{clearTimeout(t);}
  }
  return false;
}
let cursor=0; const failures=[];
async function worker(){
  while(true){
    const i=cursor++; if(i>=rows.length) return;
    const row=rows[i]; const api=apiById.get(String(row.id)); const url=clean(api?.logo_url);
    if(!api||!url||!https(url)||!(await probe(url))) failures.push(String(row.id));
  }
}
await Promise.all(Array.from({length:6},()=>worker()));
const forced=['asu-mid-south','asu-mountain-home','asu-newport'];
const targets=[...new Set([...failures,...forced])].sort();
fs.writeFileSync(outPath,JSON.stringify({failures:[...new Set(failures)].sort(),targets},null,2));
console.log(`COLLEGE_LOGO_PRE failures=${failures.length} targets=${targets.join(',')}`);
NODE

mapfile -t TARGETS < <(node - "$TARGETS_JSON" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
for(const id of p.targets||[]) console.log(id);
NODE
)

TOTAL_WRITTEN=0
TOTAL_ATTEMPTED=0
REPAIR_FAILURES="$TMPDIR/repair-failures.jsonl"
: > "$REPAIR_FAILURES"

for ((OFFSET=0; OFFSET<${#TARGETS[@]}; OFFSET+=8)); do
  CHUNK=("${TARGETS[@]:OFFSET:8}")
  BODY="$(printf '%s\n' "${CHUNK[@]}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({limit:8,schoolIds:s.trim().split(/\s+/).filter(Boolean)})))')"
  OUT="$TMPDIR/repair-$OFFSET.json"
  CODE="$(curl -sS --max-time 180 -o "$OUT" -w '%{http_code}' -X POST \
    -H 'accept: application/json' -H 'content-type: application/json' -H 'cache-control: no-store' \
    -H "x-logo-bootstrap-token: $TOKEN" --data "$BODY" "$API$COLLEGE_PATH")"
  if [ "$CODE" != "200" ]; then
    echo "COLLEGE_LOGO_REPAIR_HTTP_FAILURE offset=$OFFSET code=$CODE" >&2
    cat "$OUT" >&2 || true
    exit 1
  fi
  METRICS="$(node - "$OUT" "$REPAIR_FAILURES" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const attempted=Number(p.attempted||0),written=Number(p.written||0),fails=Array.isArray(p.failures)?p.failures:[];
if(attempted>8||written>8) throw new Error('College batch cap exceeded');
for(const f of fails) fs.appendFileSync(process.argv[3],JSON.stringify(f)+'\n');
console.log([String(p.status||''),attempted,written,fails.length,Number(p.rowsRead||0),Number(p.rowsWritten||0)].join('|'));
NODE
)"
  IFS='|' read -r STATUS ATTEMPTED WRITTEN FAILURES ROWS_READ ROWS_WRITTEN <<< "$METRICS"
  TOTAL_ATTEMPTED=$((TOTAL_ATTEMPTED + ATTEMPTED))
  TOTAL_WRITTEN=$((TOTAL_WRITTEN + WRITTEN))
  echo "COLLEGE_LOGO_REPAIR offset=$OFFSET status=$STATUS attempted=$ATTEMPTED written=$WRITTEN failures=$FAILURES rowsRead=$ROWS_READ rowsWritten=$ROWS_WRITTEN"
done

# Deploy the actual API/catalog/cache fix only after the bounded repair calls finish.
wrangler deploy

# Wait until the production catalog is served by the new version and Three Rivers is excluded.
POST_API="$TMPDIR/post-api.json"
LIVE_OK=0
for ATTEMPT in $(seq 1 20); do
  if curl -fsS --max-time 45 -H 'accept: application/json' -H 'cache-control: no-store' "$PROD_API/api/v1/schools" -o "$POST_API"; then
    if node - "$POST_API" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const schools=Array.isArray(p.schools)?p.schools:[];
const colleges=schools.filter(x=>x.level==='college');
process.exit(colleges.length===35 && !colleges.some(x=>x.id==='asu-three-rivers') ? 0 : 1);
NODE
    then
      LIVE_OK=1
      echo "COLLEGE_LOGO_PRODUCTION_READY attempt=$ATTEMPT"
      break
    fi
  fi
  sleep 3
done
if [ "$LIVE_OK" != "1" ]; then
  echo "Production college catalog did not converge to 35 supported colleges" >&2
  exit 1
fi

POST_D1="$TMPDIR/post-d1.json"
FINAL_REPORT="$TMPDIR/final-report.json"
# One combined post-repair D1 verification read.
wrangler d1 execute localbleachersar-sports --remote --command="$D1_SQL" --json > "$POST_D1"

node --input-type=module - "$POST_D1" "$POST_API" "$FINAL_REPORT" "$TARGETS_JSON" "$REPAIR_FAILURES" <<'NODE'
import fs from 'node:fs';
const [d1Path,apiPath,outPath,targetsPath,repairFailurePath]=process.argv.slice(2);
const d1Payload=JSON.parse(fs.readFileSync(d1Path,'utf8'));
const apiPayload=JSON.parse(fs.readFileSync(apiPath,'utf8'));
const targetPayload=JSON.parse(fs.readFileSync(targetsPath,'utf8'));
const envelopes=Array.isArray(d1Payload)?d1Payload:[d1Payload];
const rows=envelopes.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
if(rows.length!==35) throw new Error(`Expected 35 supported colleges, got ${rows.length}`);
const apiById=new Map((apiPayload?.schools||[]).map(x=>[String(x.id),x]));
function clean(v){return String(v??'').trim();}
function https(v){try{return new URL(clean(v)).protocol==='https:';}catch{return false;}}
function sourceClass(row){
  const s=`${clean(row.brand_provider)} ${clean(row.brand_source_url)} ${clean(row.brand_logo_url)} ${clean(row.school_logo_url)}`.toLowerCase();
  if(/official-college|\.edu\/?|athletic|sports/.test(s)) return 'official-or-school-owned';
  if(/maxpreps|scorestream|sidearm|prestosports/.test(s)) return 'established-sports-platform';
  return 'unknown';
}
async function probe(url){
  const raw=clean(url);
  if(!raw||!https(raw)) return {ok:false,reason:!raw?'blank-url':'not-https'};
  let last='fetch-error';
  for(const range of [true,false]){
    const c=new AbortController(); const t=setTimeout(()=>c.abort(),15000);
    try{
      const headers={accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','user-agent':'Mozilla/5.0 LocalBleachersAR final logo audit'};
      if(range) headers.range='bytes=0-4095';
      const r=await fetch(raw,{method:'GET',headers,redirect:'follow',signal:c.signal});
      const ct=clean(r.headers.get('content-type')).toLowerCase();
      if(r.ok&&ct.startsWith('image/')) return {ok:true,status:r.status,contentType:ct,finalUrl:clean(r.url)||raw};
      last=r.ok?`non-image:${ct||'missing'}`:`http-${r.status}`;
      if(![403,405,416].includes(r.status)) break;
    }catch(e){last=`fetch:${String(e?.name||e?.message||e)}`;} finally{clearTimeout(t);}
  }
  return {ok:false,reason:last};
}
let cursor=0; const audited=new Array(rows.length);
async function worker(){
  while(true){
    const i=cursor++; if(i>=rows.length) return;
    const d1=rows[i],api=apiById.get(String(d1.id)); const url=clean(api?.logo_url); const p=await probe(url);
    const reasons=[];
    if(!api) reasons.push('missing-api');
    if(!url) reasons.push('blank-api-logo');
    if(url&&!https(url)) reasons.push('not-https');
    if(url&&!p.ok) reasons.push(p.reason||'unreachable');
    audited[i]={schoolId:String(d1.id),schoolName:String(d1.name),storedSchoolLogoUrl:clean(d1.school_logo_url)||null,storedBrandLogoUrl:clean(d1.brand_logo_url)||null,apiLogoUrl:url||null,appWouldRender:Boolean(api&&url&&https(url)&&p.ok),sourceClass:sourceClass(d1),failureReasons:reasons};
  }
}
await Promise.all(Array.from({length:6},()=>worker()));
const failures=audited.filter(x=>!x.appWouldRender);
const suspicious=audited.filter(x=>x.appWouldRender&&x.sourceClass==='unknown');
const repairFailures=fs.existsSync(repairFailurePath)?fs.readFileSync(repairFailurePath,'utf8').trim().split(/\n+/).filter(Boolean).map(x=>JSON.parse(x)):[];
const report={
  status:failures.length===0?'COMPLETE':'PARTIAL',
  supportedColleges:35,
  appRenderable:35-failures.length,
  appFallback:failures.length,
  preRepairFailures:targetPayload.failures||[],
  attemptedTargets:targetPayload.targets||[],
  repairFailures,
  failures:failures.map(x=>({schoolId:x.schoolId,schoolName:x.schoolName,reasons:x.failureReasons})),
  suspiciousSemanticSources:suspicious.map(x=>({schoolId:x.schoolId,schoolName:x.schoolName,apiLogoUrl:x.apiLogoUrl})),
  schools:audited,
  d1Meta:{rowsRead:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_read||x?.meta?.rowsRead||0),0),rowsWritten:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0)}
};
fs.writeFileSync(outPath,JSON.stringify(report,null,2));
console.log(`COLLEGE_LOGO_FINAL status=${report.status} appRenderable=${report.appRenderable} appFallback=${report.appFallback} suspicious=${report.suspiciousSemanticSources.length}`);
for(const f of report.failures) console.log(`COLLEGE_LOGO_FINAL_FAILURE ${f.schoolId} ${f.reasons.join(',')}`);
NODE

node - "$FINAL_REPORT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require('fs'),result=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
process.stdout.write(`const RESULT=${JSON.stringify(result)};\nexport default {fetch(request){if(new URL(request.url).pathname==="/college-logo-finish-result")return Response.json(RESULT,{headers:{"cache-control":"no-store"}});return new Response("Not found",{status:404});}};\n`);
NODE

ALIAS="$(node - "$FINAL_REPORT" <<'NODE'
const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const codes={'uark':'a','arkansas-state':'b','uapb':'c','uca':'d','little-rock':'e','arkansas-tech':'f','uafs':'g','uam':'h','harding':'i','henderson-state':'j','ouachita-baptist':'k','southern-arkansas':'l','hendrix':'m','lyon':'n','ozarks':'o','arkansas-baptist':'p','cbc':'q','crowleys-ridge':'r','john-brown':'s','philander-smith':'t','williams-baptist':'u','asu-mid-south':'v','asu-mountain-home':'w','asu-newport':'x','national-park':'y','north-arkansas':'z','nwacc':'1','shorter':'2','south-arkansas':'3','seark':'4','sau-tech':'5','ua-rich-mountain':'6','ua-cossatot':'7','champion-christian':'8','ecclesia':'9'};
const ids=(p.failures||[]).map(x=>codes[x.schoolId]||'0').join('');
console.log((p.appFallback===0?'college35-ok':`college35-f${p.appFallback}-${ids}`).slice(0,32));
NODE
)"

wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars
KEEP_RESULT=1

echo "COLLEGE_LOGO_RESULT_ALIAS=$ALIAS"
echo "COLLEGE_LOGO_RESULT_URL=https://${ALIAS}-${WORKER_NAME}.james-methvin74.workers.dev/college-logo-finish-result"
cat "$FINAL_REPORT"
