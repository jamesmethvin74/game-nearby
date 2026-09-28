#!/usr/bin/env bash
set -euo pipefail

ALIAS="wvb-certified-once"
WORKER="localbleachersar-sports-api"
API_FALLBACK="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
WRAPPER="src/_wvb-certified-once.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TOKEN_ACTIVE=0

cleanup(){
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

node --check src/dragonfly-certified-statewide.js
node --check src/one-truth.js
node --check src/m8-final-audit-worker.js

cat > "$WRAPPER" <<'NODE'
import app from "./m8-final-audit-worker.js";
import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { buildCertifiedStatewideRows, runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";
import { rebuildOneTruth } from "./one-truth.js";

const TOKEN="__TOKEN__";
const READY="/api/wvb-certified-once-ready";
const RUN="/api/wvb-certified-once-run";
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const score=v=>{ if(v===null||v===undefined||v==="")return null; const n=Number(String(v).replace(/[^0-9.-]/g,"")); return Number.isFinite(n)?n:null; };
const scoredFinal=g=>String(g?.status||"").toUpperCase()==="FINAL"&&score(g?.team_score)!=null&&score(g?.opponent_score)!=null&&Number(g?.counts_for_record??1)!==0;
const eventId=e=>clean(e?.eventId||e?.id);
const eventAt=e=>clean(e?.date||e?.startDateTime||e?.scheduledAt);
const eventIsOfficial=e=>{const d=eventAt(e).slice(0,10);return d&&d>="2026-08-24";};
function participantScorePair(p,other){const a=score(p?.result?.score);const b=score(p?.result?.opponentScore)??score(other?.result?.score);return a!=null&&b!=null?[a,b]:null;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});}
function ctx(){return {waitUntil(){},passThroughOnException(){}};}

async function run(env){
  const config=statewideSportConfig("WVB");
  if(config.key!=="volleyball-girls"||Number(config.normalizationVersion)!==2) throw new Error("unexpected WVB config");
  const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{headers:{"user-agent":"LocalBleachersAR-approved-wvb-once/1.0","accept":"application/json"}});
  const payload=fetched.payload;
  const schedule=Array.isArray(payload?.schedule)?payload.schedule:[];

  const [mappingQ,schoolQ,targetQ,beforeState]=await Promise.all([
    env.DB.prepare(`SELECT tei.external_team_id,src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,sch.name AS school_name,sch.latitude,sch.longitude
      FROM team_external_identities tei
      JOIN teams t ON t.id=tei.team_id
      JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local' AND sch.level='high-school' AND sch.state='AR'
      JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide'
      WHERE tei.provider=? AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1`).bind(config.teamIdentityProvider,config.sport,config.gender,config.season).all(),
    env.DB.prepare(`SELECT UPPER(sei.external_school_id) AS external_school_id,
        src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,sch.name AS school_name,sch.latitude,sch.longitude,t.conference_id
      FROM school_external_identities sei
      JOIN teams t ON t.school_id=sei.school_id
      JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local' AND sch.level='high-school' AND sch.state='AR'
      JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide'
      WHERE sei.provider='dragonfly' AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1`).bind(config.sport,config.gender,config.season).all(),
    env.DB.prepare(`SELECT t.id AS team_id,t.school_id,sch.name AS school_name FROM teams t JOIN schools sch ON sch.id=t.school_id
      WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
        AND sch.catalog_scope='local' AND sch.level='high-school' AND sch.state='AR'`).all(),
    env.DB.prepare("SELECT details_json,last_successful_fetch_at FROM statewide_collection_state WHERE id=?").bind(config.stateId).first()
  ]);
  const mappings=mappingQ.results||[], schoolMappings=schoolQ.results||[], targets=targetQ.results||[];
  const direct=new Map(mappings.map(m=>[clean(m.external_team_id),m]));
  const uniqueSchool=new Map(), ambiguous=new Set();
  for(const m of schoolMappings){
    const k=clean(m.external_school_id).toUpperCase(); if(!k||ambiguous.has(k))continue;
    if(uniqueSchool.has(k)&&uniqueSchool.get(k).team_id!==m.team_id){uniqueSchool.delete(k);ambiguous.add(k);} else uniqueSchool.set(k,m);
  }

  const fallback=[];
  for(const e of schedule){
    if(!eventIsOfficial(e)) continue;
    const ps=Array.isArray(e?.participants)?e.participants:[];
    for(let i=0;i<ps.length;i++){
      const p=ps[i], other=ps.find((_,j)=>j!==i);
      const pair=participantScorePair(p,other); if(!pair) continue;
      const teamId=clean(p?.team?.teamId);
      if(teamId&&direct.has(teamId)) continue;
      const org=clean(p?.orgShortCode).toUpperCase();
      const m=uniqueSchool.get(org); if(!m) continue;
      const key=`${eventId(e)}|${m.team_id}`;
      if(fallback.some(x=>x.key===key)) continue;
      fallback.push({key,event_id:eventId(e),scheduled_at:eventAt(e),team_id:m.team_id,school_id:m.school_id,school_name:m.school_name,org_short_code:org,provider_team_id:teamId||null,team_score:pair[0],opponent_score:pair[1],opponent:clean(other?.name)});
    }
  }

  const normalized=buildCertifiedStatewideRows(payload,mappings,config,{checkedAt:new Date().toISOString(),schoolMappings});
  const normalizedOfficial=normalized.games.filter(scoredFinal);
  const normalizedTeams=new Set(normalizedOfficial.map(g=>g.team_id));
  const normalizedEvents=new Set(normalizedOfficial.map(g=>String(g.source_event_key||"")));

  const result=await runCertifiedDragonFlyStatewideCollection(env,config,{payload});
  if(result.status!=="SUCCESS") throw new Error(`expected SUCCESS after normalizationVersion bump, got ${result.status}`);
  const truthRefresh=await rebuildOneTruth(env,{season:"2026",teamIds:result.touchedTeamIds});

  const [d1Q,truthQ]=await Promise.all([
    env.DB.prepare(`SELECT g.id,g.team_id,g.source_event_key,g.status,g.team_score,g.opponent_score,g.counts_for_record,g.canonical_event_id
      FROM games g JOIN teams t ON t.id=g.team_id JOIN sources src ON src.id=g.source_id
      WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
        AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'
        AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL AND COALESCE(g.counts_for_record,1)<>0`).all(),
    env.DB.prepare(`SELECT truth_id,team_id,game_id,canonical_event_id,status,team_score,opponent_score,counts_for_record
      FROM ONE_TRUTH_TB WHERE row_type='GAME' AND sport='volleyball' AND gender='girls' AND season='2026'
        AND status='FINAL' AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND COALESCE(counts_for_record,1)<>0`).all()
  ]);
  const d1=d1Q.results||[], truth=truthQ.results||[];
  const d1Teams=new Set(d1.map(r=>r.team_id)), truthTeams=new Set(truth.map(r=>r.team_id));
  const d1Events=new Set(d1.map(r=>String(r.source_event_key||"")));
  const truthCanon=new Set(truth.map(r=>String(r.canonical_event_id||r.game_id||"")).filter(Boolean));

  let recoveredD1=0,recoveredTruth=0,appVerified=0;
  const fallbackVerification=[];
  for(const f of fallback){
    const expected=normalizedOfficial.find(g=>g.team_id===f.team_id&&String(g.source_event_key||"")===`native:${String(f.event_id).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}`)
      || normalizedOfficial.find(g=>g.team_id===f.team_id&&String(g.id||"").includes(String(f.event_id).toLowerCase().replace(/[^a-z0-9]+/g,"-")));
    const gameId=expected?.id||null;
    const d1row=gameId?d1.find(r=>r.id===gameId):null;
    const truthRow=gameId?truth.find(r=>r.game_id===gameId|| (d1row?.canonical_event_id&&r.canonical_event_id===d1row.canonical_event_id&&r.team_id===f.team_id)):null;
    if(d1row) recoveredD1++;
    if(truthRow) recoveredTruth++;
    const scheduleResp=await app.fetch(new Request(`https://localbleachers.internal/api/v1/teams/${encodeURIComponent(f.team_id)}/schedule`),env,ctx());
    const recordResp=await app.fetch(new Request(`https://localbleachers.internal/api/v1/teams/${encodeURIComponent(f.team_id)}/record`),env,ctx());
    const scheduleText=await scheduleResp.text(), recordText=await recordResp.text();
    const appOk=scheduleResp.status===200&&recordResp.status===200&&gameId&&scheduleText.includes(gameId)&&scheduleText.includes("FINAL")&&scheduleText.includes(String(f.team_score))&&scheduleText.includes(String(f.opponent_score));
    if(appOk) appVerified++;
    fallbackVerification.push({...f,game_id:gameId,d1:Boolean(d1row),truth:Boolean(truthRow),schedule_http:scheduleResp.status,record_http:recordResp.status,app_ok:Boolean(appOk),record_bytes:recordText.length});
  }

  let before={}; try{before=beforeState?.details_json?JSON.parse(beforeState.details_json):{};}catch{}
  return {
    status:result.status,
    normalization_version:config.normalizationVersion,
    before_signature:before.signature||null,
    after_signature:result.signature,
    raw_events:result.rawEventCount,
    observations:result.observations,
    canonical_events:result.canonicalEvents,
    touched_teams:result.touchedTeams,
    target_teams:targets.length,
    mapped_teams:new Set(mappings.map(m=>m.team_id)).size,
    normalized_official_scored_teams:normalizedTeams.size,
    normalized_unique_scored_events:normalizedEvents.size,
    d1_official_scored_teams:d1Teams.size,
    d1_unique_scored_events:d1Events.size,
    truth_official_scored_teams:truthTeams.size,
    truth_unique_scored_events:truthCanon.size,
    fallback_cases:fallbackVerification,
    fallback_recovered_d1:recoveredD1,
    fallback_recovered_truth:recoveredTruth,
    fallback_app_verified:appVerified,
    one_truth_refresh:truthRefresh,
    pages_fetched:fetched.pageCount
  };
}

export default {async fetch(request,env){
  const url=new URL(request.url),ok=request.headers.get("x-wvb-token")===TOKEN;
  if(request.method==="HEAD"&&url.pathname===READY) return ok?new Response(null,{status:204}):json({error:"not_found"},404);
  if(request.method==="POST"&&url.pathname===RUN){
    if(!ok)return json({error:"not_found"},404);
    try{return json(await run(env));}catch(error){return json({status:"FAILURE",error:String(error?.stack||error?.message||error)},500);}
  }
  return json({error:"not_found"},404);
}};
NODE
sed -i "s/__TOKEN__/$TOKEN/" "$WRAPPER"

UPLOAD="$TMPDIR/upload.log"
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD"
TOKEN_ACTIVE=1
API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
[ -n "$API" ] || API="$API_FALLBACK"

READY_CODE=""
for ATTEMPT in $(seq 1 30); do
  READY_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-wvb-token: $TOKEN" "$API/api/wvb-certified-once-ready" || true)"
  [ "$READY_CODE" = "204" ] && break
  sleep 2
done
[ "$READY_CODE" = "204" ] || { echo "WVB preview not ready: $READY_CODE" >&2; exit 1; }

OUT="$TMPDIR/result.json"
HTTP="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}' -X POST -H "x-wvb-token: $TOKEN" -H 'content-type: application/json' --data '{}' "$API/api/wvb-certified-once-run")"
if [ "$HTTP" != "200" ]; then cat "$OUT" >&2 || true; exit 1; fi

node - "$OUT" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(p.status!=="SUCCESS") throw new Error("collection did not succeed");
if(Number(p.target_teams)!==185||Number(p.mapped_teams)!==185) throw new Error("WVB target/mapping invariant failed");
if(Number(p.fallback_cases?.length||0)!==2) throw new Error("expected exactly two certified fallback cases");
if(Number(p.fallback_recovered_d1)!==2||Number(p.fallback_recovered_truth)!==2||Number(p.fallback_app_verified)!==2) throw new Error("fallback recovery proof incomplete");
console.log("WVB_CERTIFIED_ONCE="+JSON.stringify(p));
NODE

SUMMARY_ALIAS="$(node - "$OUT" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const fields=[
 [p.raw_events,13],[p.observations,13],[p.canonical_events,12],[p.touched_teams,8],
 [p.normalized_official_scored_teams,8],[p.d1_official_scored_teams,8],[p.truth_official_scored_teams,8],
 [p.fallback_cases?.length,3],[p.fallback_recovered_d1,3],[p.fallback_recovered_truth,3],[p.fallback_app_verified,3]
];
let packed=0n;
for(const [raw,bits] of fields){const v=BigInt(Math.max(0,Number(raw)||0));const max=(1n<<BigInt(bits))-1n;if(v>max)throw new Error("overflow");packed=(packed<<BigInt(bits))|v;}
const codes=(p.fallback_cases||[]).map(x=>String(x.school_id||"").replace(/^df-/,"").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,6));
const alias="w"+packed.toString(36)+"-"+codes.join("-");
if(alias.length>35) throw new Error("alias too long "+alias.length+" "+alias);
console.log(alias);
NODE
)"

# Remove the live execution credential before the build ends.
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=0
# Final upload is benign; only its alias carries compact proof into the GitHub Cloudflare check summary.
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$SUMMARY_ALIAS" --keep-vars >/dev/null
echo "WVB_CERTIFIED_RESULT_ALIAS=$SUMMARY_ALIAS"
