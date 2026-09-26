#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ALIAS="dragonfly-loss-trace"
WORKER="localbleachersar-sports-api"
API_FALLBACK="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
READY_PATH="/api/dragonfly-loss-trace-ready"
RUN_PATH="/api/dragonfly-loss-trace"
WRAPPER="src/_dragonfly-loss-trace.mjs"
RESULT_WRAPPER="src/_dragonfly-loss-trace-result.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
cleanup(){ rm -f "$WRAPPER" "$RESULT_WRAPPER"; rm -rf "$TMPDIR"; }
trap cleanup EXIT INT TERM

cat > "$WRAPPER" <<'NODE'
import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { buildCertifiedStatewideRows, collapseCertifiedProviderDuplicates } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";
import { rowIsOfficialSeasonContest } from "./schedule-response-normalizer.js";

const TOKEN="__TOKEN__";
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const num=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/[^0-9.-]/g,""));return Number.isFinite(n)?n:null;};
const participants=e=>Array.isArray(e?.participants)?e.participants:[];
const eventId=e=>clean(e?.eventId||e?.id||e?.gameId||e?.contestId||e?.uuid);
const eventDate=e=>clean(e?.date||e?.startDateTime||e?.scheduledAt||e?.startTime||e?.dateTime||e?.eventDateTime||e?.start);
const safe=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const scorePairParticipants=e=>{
  const ps=participants(e); if(ps.length<2)return false;
  for(let i=0;i<ps.length;i++){
    const own=num(ps[i]?.result?.score);
    const other=ps.find((_,j)=>j!==i);
    const opp=num(ps[i]?.result?.opponentScore)??num(other?.result?.score);
    if(own!==null&&opp!==null)return true;
  }
  return false;
};
const resultArrayScores=e=>{
  const rs=Array.isArray(e?.results)?e.results:[]; const scores=[];
  for(const r of rs){
    const a=num(r?.score??r?.teamScore??r?.points??r?.value); if(a!==null)scores.push(a);
    const h=num(r?.homeScore??r?.home?.score), w=num(r?.awayScore??r?.away?.score);
    if(h!==null&&w!==null)return true;
  }
  return scores.length>=2;
};
const legacyScores=e=>{
  const xs=[e?.homeScore,e?.awayScore,e?.visitorScore,e?.score?.home,e?.score?.away,e?.home?.score,e?.away?.score,e?.home_team?.score,e?.away_team?.score].map(num).filter(v=>v!==null);
  return xs.length>=2;
};
const usable=e=>scorePairParticipants(e)||resultArrayScores(e)||legacyScores(e);
const scoredFinal=g=>g?.status==="FINAL"&&g?.team_score!=null&&g?.opponent_score!=null;
const sameScore=(a,b)=>Number(a?.team_score)===Number(b?.team_score)&&Number(a?.opponent_score)===Number(b?.opponent_score);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  const authorized=request.headers.get("x-audit-token")===TOKEN;
  if(request.method==="HEAD"&&url.pathname==="/api/dragonfly-loss-trace-ready") return authorized?new Response(null,{status:204}):json({error:"not_found"},404);
  if(request.method!=="GET"||url.pathname!=="/api/dragonfly-loss-trace"||!authorized) return json({error:"not_found"},404);

  const config=statewideSportConfig("WVB");
  const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{headers:{"user-agent":"LocalBleachersAR-loss-trace/1.0","accept":"application/json"}});
  const schedule=Array.isArray(fetched.payload?.schedule)?fetched.payload.schedule:[];
  const mappingQuery=await env.DB.prepare(
    "SELECT tei.external_team_id,src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,sch.name AS school_name,sch.latitude,sch.longitude "+
    "FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id "+
    "JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' "+
    "WHERE tei.provider=? AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1"
  ).bind(config.teamIdentityProvider,config.sport,config.gender,config.season).all();
  const mappings=mappingQuery.results||[];
  const mappingByExternal=new Map(mappings.map(m=>[String(m.external_team_id),m]));
  const rows=buildCertifiedStatewideRows(fetched.payload,mappings,config,{checkedAt:new Date().toISOString()});
  const normalizedFinals=rows.games.filter(scoredFinal);
  const normalizedIds=new Set(normalizedFinals.map(g=>clean(g.source_event_key).replace(/^native:/,"")));
  const anyNormalizedIds=new Set(rows.games.map(g=>clean(g.source_event_key).replace(/^native:/,"")));

  const rawUsable=schedule.filter(usable);
  const rawMiss=rawUsable.filter(e=>!normalizedIds.has(safe(eventId(e))));
  const rawClasses={
    total:rawMiss.length,
    present_but_unscored:0,
    absent_from_normalizer:0,
    results_array_only:0,
    legacy_only:0,
    participant_pair_present:0,
    zero_mapped_participants:0,
    one_mapped_participant:0,
    two_plus_mapped_participants:0,
    invalid_event_id_or_date:0
  };
  const rawExamples=[];
  for(const e of rawMiss){
    const id=eventId(e), key=safe(id);
    const mapped=participants(e).filter(p=>mappingByExternal.has(clean(p?.team?.teamId))).length;
    const pp=scorePairParticipants(e), rp=resultArrayScores(e), lp=legacyScores(e);
    if(anyNormalizedIds.has(key)) rawClasses.present_but_unscored++; else rawClasses.absent_from_normalizer++;
    if(!pp&&rp) rawClasses.results_array_only++;
    if(!pp&&!rp&&lp) rawClasses.legacy_only++;
    if(pp) rawClasses.participant_pair_present++;
    if(mapped===0) rawClasses.zero_mapped_participants++;
    else if(mapped===1) rawClasses.one_mapped_participant++;
    else rawClasses.two_plus_mapped_participants++;
    if(!id||!Number.isFinite(Date.parse(eventDate(e)))) rawClasses.invalid_event_id_or_date++;
    rawExamples.push({
      event_id:id,
      date:eventDate(e),
      participant_names:participants(e).map(p=>clean(p?.name)),
      participant_team_ids:participants(e).map(p=>clean(p?.team?.teamId)),
      participant_results:participants(e).map(p=>p?.result??null),
      results:Array.isArray(e?.results)?e.results:null,
      mapped_participants:mapped,
      participant_pair:pp,results_pair:rp,legacy_pair:lp,
      normalized_any:anyNormalizedIds.has(key)
    });
  }

  const gameQuery=await env.DB.prepare(
    "SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.status,g.team_score,g.opponent_score,g.canonical_event_id,g.notes,g.updated_at,g.last_checked_at,"+
    "src.last_successful_fetch_at,ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,ce.trust_state AS canonical_trust_state,ce.conflict_count AS canonical_conflict_count,"+
    "t.school_id,t.sport,t.gender,t.season,sch.name AS school_name "+
    "FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id "+
    "LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id "+
    "WHERE t.active=1 AND t.season=? AND t.sport='volleyball' AND t.gender='girls' AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'"
  ).bind(config.season).all();
  const truthQuery=await env.DB.prepare(
    "SELECT truth_id,row_type,team_id,game_id,canonical_event_id,status,team_score,opponent_score,refreshed_at,source_id,parser_type "+
    "FROM ONE_TRUTH_TB WHERE season=? AND sport='volleyball' AND gender='girls'"
  ).bind(config.season).all();
  const prod=gameQuery.results||[], truth=truthQuery.results||[];
  const prodById=new Map(prod.map(r=>[String(r.id),r]));
  const truthByTeam=new Map();
  const teamSummary=new Map();
  for(const r of truth){
    if(r.row_type==="TEAM") teamSummary.set(String(r.team_id),r);
    else if(r.row_type==="GAME"){
      const k=String(r.team_id||""); if(!truthByTeam.has(k))truthByTeam.set(k,[]); truthByTeam.get(k).push(r);
    }
  }

  const missingObs=[];
  for(const expected of normalizedFinals){
    const d1=prodById.get(String(expected.id)); if(!d1) continue;
    const candidates=truthByTeam.get(String(expected.team_id))||[];
    const truthRow=candidates.find(r=>String(r.game_id||"")===String(expected.id))
      ||(d1.canonical_event_id?candidates.find(r=>String(r.canonical_event_id||"")===String(d1.canonical_event_id)):null)
      ||null;
    if(truthRow&&scoredFinal(truthRow)&&sameScore(truthRow,expected)) continue;

    const canonicalScored=clean(d1.canonical_status).toUpperCase()==="FINAL"&&d1.canonical_home_score!=null&&d1.canonical_away_score!=null;
    const canonicalIncomplete=Boolean(d1.canonical_event_id)&&!canonicalScored;
    const suppressed=clean(d1.notes).includes("Excluded from current LocalBleachers presentation")
      ||clean(d1.notes).includes("Removed from current statewide DragonFly schedule");
    const candidateForSeason={
      level:"high-school",sport:"volleyball",season:"2026",parser_type:"dragonfly-public",
      counts_for_record:1,notes:d1.notes,opponent:"",venue:"",location_text:"",
      scheduled_at:expected.scheduled_at
    };
    const filteredOfficial=!rowIsOfficialSeasonContest(candidateForSeason);
    const summary=teamSummary.get(String(expected.team_id));
    const stale=Boolean(summary)&&(
      Date.parse(d1.updated_at||d1.last_checked_at||"")>Date.parse(summary.refreshed_at||"")
      ||Date.parse(d1.last_successful_fetch_at||"")>Date.parse(summary.refreshed_at||"")
    );
    const truthPresent=Boolean(truthRow);
    let klass="other";
    if(suppressed) klass="suppressed";
    else if(canonicalIncomplete) klass="canonical_incomplete_overrides_raw_final";
    else if(filteredOfficial) klass="official_filter";
    else if(truthPresent) klass="truth_present_wrong_status_or_score";
    else if(stale) klass="stale_truth";
    missingObs.push({
      event_key:expected.source_event_key,
      team_id:expected.team_id,
      game_id:expected.id,
      opponent:expected.opponent,
      scheduled_at:expected.scheduled_at,
      canonical_event_id:d1.canonical_event_id||null,
      class:klass,
      d1:{status:d1.status,team_score:d1.team_score,opponent_score:d1.opponent_score,canonical_status:d1.canonical_status,canonical_home_score:d1.canonical_home_score,canonical_away_score:d1.canonical_away_score,notes:d1.notes,updated_at:d1.updated_at,source_checked_at:d1.last_successful_fetch_at},
      truth:truthRow?{game_id:truthRow.game_id,canonical_event_id:truthRow.canonical_event_id,status:truthRow.status,team_score:truthRow.team_score,opponent_score:truthRow.opponent_score,refreshed_at:truthRow.refreshed_at}:null,
      team_refreshed_at:summary?.refreshed_at||null
    });
  }

  const eventMap=new Map();
  for(const m of missingObs){
    const k=String(m.event_key||""); if(!eventMap.has(k))eventMap.set(k,[]); eventMap.get(k).push(m);
  }
  const priority=["suppressed","canonical_incomplete_overrides_raw_final","official_filter","truth_present_wrong_status_or_score","stale_truth","other"];
  const eventClasses={suppressed:0,canonical_incomplete_overrides_raw_final:0,official_filter:0,truth_present_wrong_status_or_score:0,stale_truth:0,other:0};
  for(const items of eventMap.values()){
    let chosen="other";
    for(const p of priority){if(items.some(x=>x.class===p)){chosen=p;break;}}
    eventClasses[chosen]++;
  }

  return json({
    audit_version:"dragonfly-loss-trace-v1",
    raw:{classes:rawClasses,examples:rawExamples},
    truth:{
      missing_events:eventMap.size,
      missing_observations:missingObs.length,
      classes:eventClasses,
      examples:missingObs.slice(0,100)
    },
    rows_written:0
  });
 }
};
NODE
sed -i "s/__TOKEN__/$TOKEN/" "$WRAPPER"
node --check "$WRAPPER"

UPLOAD_LOG="$TMPDIR/upload.log"
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_LOG"
API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD_LOG" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
if [ -z "$API" ]; then API="$API_FALLBACK"; fi

READY=""
for ATTEMPT in $(seq 1 40); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-audit-token: $TOKEN" "$API$READY_PATH" || true)"
  if [ "$READY" = "204" ]; then break; fi
  sleep 3
done
[ "$READY" = "204" ] || { echo "trace preview not ready: $READY" >&2; exit 1; }

OUT="$TMPDIR/result.json"
HTTP_STATUS="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}' -H "x-audit-token: $TOKEN" "$API$RUN_PATH")"
[ "$HTTP_STATUS" = "200" ] || { cat "$OUT" >&2 || true; exit 1; }

node - "$OUT" <<'NODE'
const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(Number(p.rows_written||0)!==0) throw new Error("trace must be read-only");
console.log("DRAGONFLY_LOSS_TRACE="+JSON.stringify({raw:p.raw.classes,truth:p.truth}));
NODE

node - "$OUT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require("fs");const body=fs.readFileSync(process.argv[2],"utf8");
process.stdout.write(`const BODY=${JSON.stringify(body)};export default{async fetch(){return new Response(BODY,{headers:{"content-type":"application/json","cache-control":"no-store"}})}};`);
NODE

# Compact the essential classification counts into the final preview alias.
SUMMARY_ALIAS="$(node - "$OUT" <<'NODE'
const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const r=p.raw.classes,t=p.truth.classes;
const fields=[
 [r.total,5],[r.present_but_unscored,5],[r.absent_from_normalizer,5],[r.results_array_only,5],[r.legacy_only,5],[r.participant_pair_present,5],
 [r.zero_mapped_participants,5],[r.one_mapped_participant,5],[r.two_plus_mapped_participants,5],[r.invalid_event_id_or_date,5],
 [p.truth.missing_events,10],[p.truth.missing_observations,10],
 [t.suppressed,10],[t.canonical_incomplete_overrides_raw_final,10],[t.official_filter,10],[t.truth_present_wrong_status_or_score,10],[t.stale_truth,10],[t.other,10]
];
let packed=0n;
for(const [raw,bits] of fields){const v=BigInt(Math.max(0,Number(raw)||0));if(v>((1n<<BigInt(bits))-1n))throw new Error("overflow");packed=(packed<<BigInt(bits))|v;}
const alias="z"+packed.toString(36);if(alias.length>35)throw new Error("alias too long "+alias.length);console.log(alias);
NODE
)"
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$SUMMARY_ALIAS" --keep-vars >/dev/null
echo "DRAGONFLY_LOSS_TRACE_ALIAS=$SUMMARY_ALIAS"
