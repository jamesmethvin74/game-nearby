#!/usr/bin/env bash
set -euo pipefail

npm run check

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

WORKER_NAME="localbleachersar-sports-api"
PROD_API="https://${WORKER_NAME}.james-methvin74.workers.dev"
D1_OUT="$TMPDIR/high-school-d1.json"
API_OUT="$TMPDIR/high-school-api.json"
REPORT_OUT="$TMPDIR/high-school-logo-app-audit.json"
RESULT_WORKER="src/high-school-logo-audit-result-worker.js"

D1_SQL="SELECT
  s.id,
  s.name,
  s.logo_url AS school_logo_url,
  b.logo_url AS brand_logo_url,
  b.provider AS brand_provider,
  b.provider_name AS brand_provider_name,
  b.source_url AS brand_source_url,
  b.match_method AS brand_match_method,
  b.match_confidence AS brand_match_confidence,
  b.status AS brand_status,
  b.verified_at AS brand_verified_at
FROM schools s
LEFT JOIN school_brand_assets b ON b.school_id=s.id
WHERE s.catalog_scope='local'
  AND s.level='high-school'
  AND s.id NOT IN ('df-2tng4g','df-cc7dyc','df-abs2rr','df-qscp6x','df-urlzfa','df-25lkrp')
ORDER BY s.id"

# Exactly one bounded production D1 read of the 300 supported high-school rows. No writes.
wrangler d1 execute localbleachersar-sports --remote --command="$D1_SQL" --json > "$D1_OUT"

# One production school-catalog response. The Worker-side cache version is already logo-safe.
curl -fsS --max-time 45 \
  -H 'accept: application/json' \
  -H 'cache-control: no-store' \
  "$PROD_API/api/v1/schools" \
  -o "$API_OUT"

node --input-type=module - "$D1_OUT" "$API_OUT" "$REPORT_OUT" <<'NODE'
import fs from 'node:fs';

const [d1Path, apiPath, reportPath] = process.argv.slice(2);
const d1Payload = JSON.parse(fs.readFileSync(d1Path, 'utf8'));
const apiPayload = JSON.parse(fs.readFileSync(apiPath, 'utf8'));
const envelopes = Array.isArray(d1Payload) ? d1Payload : [d1Payload];
const d1Rows = envelopes.flatMap(x => Array.isArray(x?.results) ? x.results : []);
const apiSchools = Array.isArray(apiPayload?.schools) ? apiPayload.schools : [];
const apiById = new Map(apiSchools.map(row => [String(row.id), row]));

if (d1Rows.length !== 300) throw new Error(`Expected exactly 300 supported high schools, got ${d1Rows.length}`);

function clean(value) { return String(value ?? '').trim(); }
function isHttps(value) {
  try { return new URL(clean(value)).protocol === 'https:'; } catch { return false; }
}
function sourceClass(row) {
  const text = [row.brand_provider,row.brand_provider_name,row.brand_source_url,row.brand_logo_url,row.school_logo_url]
    .map(clean).join(' ').toLowerCase();
  if (/maxpreps/.test(text)) return 'maxpreps';
  if (/scorestream/.test(text)) return 'scorestream';
  if (/sblive|scorebooklive/.test(text)) return 'sblive';
  if (/mascot-media|mascotmedia/.test(text)) return 'mascot-media';
  if (/official|school-owned|\.k12\.ar\.us|\.org\/athletics|athletics|sports/.test(text)) return 'official-or-school-owned';
  return 'unknown';
}

async function probeImage(url) {
  const raw = clean(url);
  if (!raw) return { reachable:false, status:null, contentType:null, finalUrl:null, reason:'blank-url' };
  if (!isHttps(raw)) return { reachable:false, status:null, contentType:null, finalUrl:raw, reason:'not-https' };
  const attempts = [
    { range:true },
    { range:false }
  ];
  let last = null;
  for (const attempt of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const headers = {
        accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent':'Mozilla/5.0 LocalBleachersAR statewide logo audit'
      };
      if (attempt.range) headers.range = 'bytes=0-4095';
      const response = await fetch(raw, { method:'GET', headers, redirect:'follow', signal:controller.signal });
      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      last = {
        reachable:response.ok && contentType.startsWith('image/'),
        status:response.status,
        contentType:contentType || null,
        finalUrl:clean(response.url) || raw,
        reason:response.ok
          ? (contentType.startsWith('image/') ? null : `non-image-content-type:${contentType || 'missing'}`)
          : `http-${response.status}`
      };
      if (last.reachable) return last;
      if (![403,405,416].includes(response.status)) return last;
    } catch (error) {
      last = { reachable:false, status:null, contentType:null, finalUrl:raw, reason:`fetch-error:${String(error?.name || error?.message || error)}` };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

let cursor = 0;
const rows = new Array(d1Rows.length);
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= d1Rows.length) return;
    const d1 = d1Rows[index];
    const api = apiById.get(String(d1.id)) || null;
    const storedSchoolUrl = clean(d1.school_logo_url) || null;
    const storedBrandUrl = clean(d1.brand_logo_url) || null;
    const apiUrl = clean(api?.logo_url) || null;
    const probe = await probeImage(apiUrl);
    const cls = sourceClass(d1);
    const failureReasons = [];
    if (!api) failureReasons.push('missing-from-production-api');
    if (!apiUrl) failureReasons.push('api-logo-blank');
    if (apiUrl && !isHttps(apiUrl)) failureReasons.push('api-logo-not-https');
    if (apiUrl && !probe.reachable) failureReasons.push(probe.reason || 'image-unreachable');
    if (storedBrandUrl && storedSchoolUrl && storedBrandUrl !== storedSchoolUrl) failureReasons.push('brand-assets-vs-schools-url-mismatch');
    if (apiUrl && storedSchoolUrl && apiUrl !== storedSchoolUrl && apiUrl !== storedBrandUrl) failureReasons.push('api-url-differs-from-both-stored-sources');
    const appWouldRender = Boolean(api && apiUrl && isHttps(apiUrl) && probe.reachable);
    if (!appWouldRender) failureReasons.push('app-letter-fallback');
    rows[index] = {
      schoolId:String(d1.id),
      schoolName:String(d1.name),
      storedSchoolLogoUrl:storedSchoolUrl,
      storedBrandLogoUrl:storedBrandUrl,
      apiLogoUrl:apiUrl,
      reachable:probe.reachable,
      httpStatus:probe.status,
      contentType:probe.contentType,
      finalImageUrl:probe.finalUrl,
      sourceClass:cls,
      brandProvider:clean(d1.brand_provider) || null,
      brandSourceUrl:clean(d1.brand_source_url) || null,
      brandMatchMethod:clean(d1.brand_match_method) || null,
      brandStatus:clean(d1.brand_status) || null,
      appWouldRender,
      appFallback:appWouldRender ? null : 'letter',
      failureReasons
    };
  }
}
await Promise.all(Array.from({length:16}, () => worker()));

const failures = rows.filter(row => !row.appWouldRender);
const suspicious = rows.filter(row => row.appWouldRender && row.sourceClass === 'unknown');
const report = {
  generatedAt:new Date().toISOString(),
  productionApi:`${'https://localbleachersar-sports-api.james-methvin74.workers.dev'}/api/v1/schools`,
  counts:{ total:rows.length, appRenderable:rows.length-failures.length, appFallback:failures.length, suspiciousSemanticSource:suspicious.length },
  d1Meta:{
    rowsRead:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_read || x?.meta?.rowsRead || 0),0),
    rowsWritten:envelopes.reduce((n,x)=>n+Number(x?.meta?.rows_written || x?.meta?.rowsWritten || 0),0)
  },
  failures:failures.map(row => ({ schoolId:row.schoolId, schoolName:row.schoolName, reasons:row.failureReasons })),
  suspiciousSemanticSources:suspicious.map(row => ({ schoolId:row.schoolId, schoolName:row.schoolName, apiLogoUrl:row.apiLogoUrl })),
  schools:rows
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`HIGH_SCHOOL_LOGO_APP_AUDIT counts=${JSON.stringify(report.counts)} d1=${JSON.stringify(report.d1Meta)}`);
for (const row of failures) console.log(`HIGH_SCHOOL_LOGO_FAILURE ${row.schoolId} ${JSON.stringify(row.failureReasons)} api=${row.apiLogoUrl || 'NULL'}`);
for (const row of suspicious) console.log(`HIGH_SCHOOL_LOGO_SEMANTIC_REVIEW ${row.schoolId} sourceClass=${row.sourceClass} api=${row.apiLogoUrl || 'NULL'}`);
NODE

ALIAS="$(node - "$REPORT_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const failures=Array.isArray(p.failures)?p.failures:[];
const suspicious=Array.isArray(p.suspiciousSemanticSources)?p.suspiciousSemanticSources:[];
function shortId(id){
  id=String(id||'').toLowerCase();
  if(id.startsWith('aaa-')) return `a${id.slice(4,10)}`;
  if(id.startsWith('df-')) return `d${id.slice(3,9)}`;
  return `l${id.replace(/[^a-z0-9]/g,'').slice(0,6)}`;
}
const review=[...failures,...suspicious.filter(s=>!failures.some(f=>f.schoolId===s.schoolId))];
const ids=review.slice(0,4).map(x=>shortId(x.schoolId)).join('-');
const base=failures.length===0&&suspicious.length===0
  ? 'hs300-ok'
  : `hs-f${failures.length}-u${suspicious.length}-${ids||'none'}`;
console.log(base.slice(0,32));
NODE
)"

node --input-type=module - "$REPORT_OUT" "$RESULT_WORKER" <<'NODE'
import fs from 'node:fs';
const [reportPath, workerPath]=process.argv.slice(2);
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const body=JSON.stringify(report);
fs.writeFileSync(workerPath,`const BODY=${JSON.stringify(body)};export default{async fetch(){return new Response(BODY,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}};`);
NODE

wrangler versions upload "$RESULT_WORKER" --preview-alias "$ALIAS" --keep-vars

echo "HIGH_SCHOOL_LOGO_RESULT_ALIAS=$ALIAS"
