#!/usr/bin/env bash
set -euo pipefail
ALIAS="wvb-postrun-proof"
WORKER="localbleachersar-sports-api"
API_FALLBACK="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
WRAPPER="src/_wvb-postrun-proof.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TOKEN_ACTIVE=0
cleanup(){ if [ "$TOKEN_ACTIVE" = "1" ]; then wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null 2>&1 || true; fi; rm -f "$WRAPPER"; rm -rf "$TMPDIR"; }
trap cleanup EXIT

cat > "$WRAPPER" <<'NODE'
import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { buildCertifiedStatewideRows } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";
const TOKEN="__TOKEN__";
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const score=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/[^0-9.-]/g,""));return Number.isFinite(n)?n:null;};
const scored=g=>String(g?.status||"").toUpperCase()==="FINAL"&&score(g?.team_score)!=null&&score(g?.opponent_score)!=null&&Number(g?.counts_for_record??1)!==0;
const eventId=e=>clean(e?.eventId||e?.id);
const eventAt=e=>clean(e?.date||e?.startDateTime||e?.scheduledAt);
function pair(p,other){const a=score(p?.result?.score),b=score(p?.result?.opponentScore)??score(other?.result?.score);return a!=null&&b!=null?[a,b]:null;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});}

export default {async fetch(req,env){
 const u=new URL(req.url),ok=req.headers.get("x-proof-token")===TOKEN;
 if(req.method==="HEAD"&&u.pathname==="/ready")return ok?new Response(null,{status:204}):json({error:"not_found"},404);
 if(req.method!=="GET"||u.pathname!=="/run"||!ok)return json({error:"not_found"},404);
 const config=statewideSportConfig("WVB");
 const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{headers:{"user-agent":"LocalBleachersAR-wvb-proof/1.0","accept":"application/json"}});
 const payload=fetched.payload,schedule=Array.isArray(payload?.schedule)?payload.schedule:[];
 const [state,mapq,schoolq,targetq,d1q,truthq]=await Promise.all([
  env.DB.prepare("SELECT last_successful_fetch_at,last_event_count,last_observation_count,last_source_count,details_json FROM statewide_collection_state WHERE id=?").bind(config.stateId).first(),
  env.DB.prepare(`SELECT tei.external_team_id,src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,sch.name AS school_name,sch.latitude,sch.longitude
    FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id
    JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide'
    WHERE tei.provider=? AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1`).bind(config.teamIdentityProvider,config.sport,config.gender,config.season).all(),
  env.DB.prepare(`SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude
    FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id
    JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide'
    WHERE sei.provider='dragonfly' AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1`).bind(config.sport,config.gender,config.season).all(),
  env.DB.prepare(`SELECT t.id team_id,t.school_id,sch.name school_name FROM teams t JOIN schools sch ON sch.id=t.school_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND sch.catalog_scope='local' AND sch.level='high-school' AND sch.state='AR'`).all(),
  env.DB.prepare(`SELECT g.id,g.team_id,g.source_event_key,g.canonical_event_id,g.status,g.team_score,g.opponent_score,g.counts_for_record
    FROM games g JOIN teams t ON t.id=g.team_id JOIN sources src ON src.id=g.source_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'
      AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL AND COALESCE(g.counts_for_record,1)<>0`).all(),
  env.DB.prepare(`SELECT truth_id,team_id,game_id,canonical_event_id,status,team_score,opponent_score,counts_for_record
    FROM ONE_TRUTH_TB WHERE row_type='GAME' AND sport='volleyball' AND gender='girls' AND season='2026'
      AND status='FINAL' AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND COALESCE(counts_for_record,1)<>0`).all()
 ]);
 const mappings=mapq.results||[],schools=schoolq.results||[],targets=targetq.results||[],d1=d1q.results||[],truth=truthq.results||[];
 const unique=new Map(),amb=new Set();
 for(const m of schools){const k=clean(m.external_school_id).toUpperCase();if(!k||amb.has(k))continue;if(unique.has(k)&&unique.get(k).team_id!==m.team_id){unique.delete(k);amb.add(k);}else unique.set(k,m);}
 const direct=new Map(mappings.map(m=>[clean(m.external_team_id),m]));
 const fallback=[];
 for(const e of schedule){if(eventAt(e).slice(0,10)<"2026-08-24")continue;const ps=Array.isArray(e?.participants)?e.participants:[];for(let i=0;i<ps.length;i++){const p=ps[i],other=ps.find((_,j)=>j!==i),sp=pair(p,other);if(!sp)continue;const pt=clean(p?.team?.teamId);if(pt&&direct.has(pt))continue;const org=clean(p?.orgShortCode).toUpperCase(),m=unique.get(org);if(!m)continue;const key=eventId(e)+"|"+m.team_id;if(fallback.some(x=>x.key===key))continue;fallback.push({key,event_id:eventId(e),team_id:m.team_id,school_id:m.school_id,school_name:m.school_name,org_short_code:org,team_score:sp[0],opponent_score:sp[1]});}}
 const normalized=buildCertifiedStatewideRows(payload,mappings,config,{schoolMappings:schools,checkedAt:new Date().toISOString()});
 const nGames=normalized.games.filter(scored),nTeams=new Set(nGames.map(x=>x.team_id));
 let details={};try{details=state?.details_json?JSON.parse(state.details_json):{};}catch{}
 let fallbackD1=0,fallbackTruth=0;
 for(const f of fallback){const safe=String(f.event_id).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");const ng=nGames.find(g=>g.team_id===f.team_id&&String(g.source_event_key||"")===`native:${safe}`);const dr=ng?d1.find(r=>r.id===ng.id):null;if(dr)fallbackD1++;if(ng&&truth.some(r=>r.game_id===ng.id||(dr?.canonical_event_id&&r.team_id===f.team_id&&r.canonical_event_id===dr.canonical_event_id)))fallbackTruth++;}
 const result={
   ran_after_trigger:Boolean(state?.last_successful_fetch_at&&Date.parse(state.last_successful_fetch_at)>=Date.parse("2026-09-28T00:48:00Z")),
   last_successful_fetch_at:state?.last_successful_fetch_at||null,last_event_count:Number(state?.last_event_count||0),last_observation_count:Number(state?.last_observation_count||0),last_source_count:Number(state?.last_source_count||0),
   signature_v2:String(details.signature||"").startsWith("volleyball-girls:v2:"),unchanged:Boolean(details.unchanged),touched_teams:Number(details.touchedTeams||0),canonical_events:Number(details.canonicalEvents||0),
   target_teams:targets.length,mapped_teams:new Set(mappings.map(m=>m.team_id)).size,normalized_scored_teams:nTeams.size,d1_scored_teams:new Set(d1.map(x=>x.team_id)).size,truth_scored_teams:new Set(truth.map(x=>x.team_id)).size,
   fallback_cases:fallback,fallback_d1:fallbackD1,fallback_truth:fallbackTruth
 };
 return json(result);
}};
NODE
sed -i "s/__TOKEN__/$TOKEN/" "$WRAPPER"
UPLOAD="$TMPDIR/upload.log"
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD"
TOKEN_ACTIVE=1
API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
[ -n "$API" ] || API="$API_FALLBACK"
READY=""
for ATTEMPT in $(seq 1 30);do READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-proof-token: $TOKEN" "$API/ready"||true)";[ "$READY" = "204" ]&&break;sleep 2;done
[ "$READY" = "204" ]||exit 1
OUT="$TMPDIR/result.json"
HTTP="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}' -H "x-proof-token: $TOKEN" "$API/run")"
[ "$HTTP" = "200" ]||{ cat "$OUT" >&2||true; exit 1; }
SUMMARY_ALIAS="$(node - "$OUT" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const fields=[
 [p.ran_after_trigger?1:0,1],[p.signature_v2?1:0,1],[p.unchanged?1:0,1],
 [p.last_event_count,13],[p.last_observation_count,13],[p.last_source_count,8],[p.touched_teams,8],[p.canonical_events,12],
 [p.normalized_scored_teams,8],[p.d1_scored_teams,8],[p.truth_scored_teams,8],
 [p.fallback_cases?.length,3],[p.fallback_d1,3],[p.fallback_truth,3]
];
let packed=0n;for(const [raw,bits] of fields){const v=BigInt(Math.max(0,Number(raw)||0));if(v>((1n<<BigInt(bits))-1n))throw new Error("overflow");packed=(packed<<BigInt(bits))|v;}
const codes=(p.fallback_cases||[]).map(x=>String(x.school_id||"").replace(/^df-/,"").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,6));
const alias="p"+packed.toString(36)+"-"+codes.join("-");if(alias.length>35)throw new Error("alias too long "+alias.length+" "+alias);console.log(alias);
NODE
)"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=0
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$SUMMARY_ALIAS" --keep-vars >/dev/null
echo "WVB_POSTRUN_PROOF_ALIAS=$SUMMARY_ALIAS"
