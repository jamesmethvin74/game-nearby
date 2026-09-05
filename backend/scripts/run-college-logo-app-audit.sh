#!/usr/bin/env bash
set -euo pipefail

npm run check

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

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
WHERE s.catalog_scope='local' AND s.level='college'
ORDER BY s.name"

D1_OUT="$TMPDIR/college-d1.json"
API_OUT="$TMPDIR/college-api.json"
REPORT_OUT="$TMPDIR/college-logo-app-audit.json"

# Exactly one bounded read of the 36 production college rows. No writes.
wrangler d1 execute localbleachersar-sports --remote --command="$D1_SQL" --json > "$D1_OUT"

curl -fsS --max-time 45 \
  -H 'accept: application/json' \
  'https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/schools' \
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

if (d1Rows.length !== 36) throw new Error(`Expected 36 production colleges, got ${d1Rows.length}`);

function clean(value) { return String(value ?? '').trim(); }
function isHttps(value) {
  try { return new URL(clean(value)).protocol === 'https:'; } catch { return false; }
}
function sourceClass(row) {
  const provider = clean(row.brand_provider).toLowerCase();
  const source = clean(row.brand_source_url).toLowerCase();
  const logo = clean(row.brand_logo_url || row.school_logo_url).toLowerCase();
  if (provider.includes('official') || /\.edu\//.test(source) || /athletics/.test(source)) return 'official-or-school-owned';
  if (/maxpreps|scorestream|sidearm|prestosports/.test(`${provider} ${source} ${logo}`)) return 'established-sports-platform';
  return 'unknown';
}

async function probeImage(url) {
  const raw = clean(url);
  if (!raw) return { reachable:false, status:null, contentType:null, finalUrl:null, reason:'blank-url' };
  if (!isHttps(raw)) return { reachable:false, status:null, contentType:null, finalUrl:raw, reason:'not-https' };

  const attempts = [
    { headers:{ accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', range:'bytes=0-4095', 'user-agent':'Mozilla/5.0 LocalBleachersAR logo audit' } },
    { headers:{ accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 'user-agent':'Mozilla/5.0 LocalBleachersAR logo audit' } }
  ];

  let last = null;
  for (const attempt of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(raw, { method:'GET', redirect:'follow', signal:controller.signal, ...attempt });
      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      last = {
        reachable: response.ok && contentType.startsWith('image/'),
        status: response.status,
        contentType: contentType || null,
        finalUrl: clean(response.url) || raw,
        reason: response.ok ? (contentType.startsWith('image/') ? null : `non-image-content-type:${contentType || 'missing'}`) : `http-${response.status}`
      };
      if (last.reachable) return last;
      if (response.status !== 416 && response.status !== 403) return last;
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
    const failureReasons = [];
    if (!api) failureReasons.push('missing-from-production-api');
    if (!apiUrl) failureReasons.push('api-logo-blank');
    if (apiUrl && !isHttps(apiUrl)) failureReasons.push('api-logo-not-https');
    if (apiUrl && !probe.reachable) failureReasons.push(probe.reason || 'image-unreachable');
    if (storedBrandUrl && storedSchoolUrl && storedBrandUrl !== storedSchoolUrl) failureReasons.push('brand-assets-vs-schools-url-mismatch');
    if (apiUrl && storedSchoolUrl && apiUrl !== storedSchoolUrl && apiUrl !== storedBrandUrl) failureReasons.push('api-url-differs-from-both-stored-sources');

    const appWouldRender = Boolean(api && apiUrl && isHttps(apiUrl) && probe.reachable);
    if (!appWouldRender && !failureReasons.includes('app-letter-fallback')) failureReasons.push('app-letter-fallback');

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
      sourceClass:sourceClass(d1),
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
await Promise.all(Array.from({length:6}, () => worker()));

const failures = rows.filter(row => !row.appWouldRender);
const suspicious = rows.filter(row => row.appWouldRender && row.sourceClass === 'unknown');
const report = {
  generatedAt:new Date().toISOString(),
  productionApi:'https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/schools',
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
console.log(`COLLEGE_LOGO_APP_AUDIT counts=${JSON.stringify(report.counts)} d1=${JSON.stringify(report.d1Meta)}`);
for (const row of failures) console.log(`COLLEGE_LOGO_FAILURE ${row.schoolId} ${JSON.stringify(row.failureReasons)} api=${row.apiLogoUrl || 'NULL'}`);
NODE

ALIAS="$(node - "$REPORT_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const codes={
'uark':'ua','arkansas-state':'as','uapb':'up','uca':'uc','little-rock':'lr','arkansas-tech':'at','uafs':'uf','uam':'um','harding':'ha','henderson-state':'hs','ouachita-baptist':'ob','southern-arkansas':'sa','hendrix':'he','lyon':'ly','ozarks':'oz','arkansas-baptist':'ab','cbc':'cb','crowleys-ridge':'cr','john-brown':'jb','philander-smith':'ps','williams-baptist':'wb','asu-mid-south':'ms','asu-mountain-home':'mh','asu-newport':'np','asu-three-rivers':'tr','national-park':'pk','north-arkansas':'na','nwacc':'nw','shorter':'sh','south-arkansas':'so','seark':'se','sau-tech':'st','ua-rich-mountain':'rm','ua-cossatot':'co','champion-christian':'cc','ecclesia':'ec'
};
const failures=Array.isArray(p.failures)?p.failures:[];
const ids=failures.map(x=>codes[String(x.schoolId)]||'xx').join('-') || 'none';
console.log(`ca-${Number(p?.counts?.appFallback||0)}-${ids}`.slice(0,32));
NODE
)"

node --input-type=module - "$REPORT_OUT" <<'NODE'
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const body = JSON.stringify(report);
const source = `const BODY=${JSON.stringify(body)};export default{async fetch(){return new Response(BODY,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}};`;
fs.writeFileSync('src/college-logo-audit-result-worker.js', source);
NODE

wrangler versions upload src/college-logo-audit-result-worker.js \
  --preview-alias "$ALIAS" \
  --keep-vars
