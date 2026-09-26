#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ALIAS="dragonfly-raw-production-compare"
WORKER="localbleachersar-sports-api"
API_FALLBACK="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
API=""
RUN_PATH="/api/dragonfly-raw-production-compare"
WRAPPER="src/_dragonfly-raw-production-compare.mjs"
RESULT_WRAPPER="src/_dragonfly-raw-production-compare-result.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TARGET="${AUDIT_TARGET:-WVB}"
case "$TARGET" in
  WVB|MBB|WBB) ;;
  *) echo "AUDIT_TARGET must be WVB, MBB, or WBB" >&2; exit 2 ;;
esac

cleanup() {
  rm -f "$WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT INT TERM

if ! grep -q '"database_name": "localbleachersar-sports"' wrangler.jsonc; then
  echo "Refusing audit: wrangler.jsonc is not bound to localbleachersar-sports" >&2
  exit 2
fi

cat > "$WRAPPER" <<'NODE'
import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { buildCertifiedStatewideRows } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";

const TOKEN="__AUDIT_TOKEN__";
const TARGETS=["__TARGET_CODE__"];

const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const num=v=>{
  if(v===null||v===undefined||v==="") return null;
  const n=Number(String(v).replace(/[^0-9.-]/g,""));
  return Number.isFinite(n)?n:null;
};
const participants=e=>Array.isArray(e?.participants)?e.participants:[];
const eventId=e=>clean(e?.eventId||e?.id||e?.gameId||e?.contestId||e?.uuid);
const eventDate=e=>clean(e?.date||e?.startDateTime||e?.scheduledAt||e?.startTime||e?.dateTime||e?.eventDateTime||e?.start);
const explicitStatus=e=>clean(e?.status?.name||e?.status||e?.gameStatus||e?.state).toUpperCase();
const isExplicitFinal=e=>/FINAL|COMPLETE|COMPLETED/.test(explicitStatus(e));
const safe=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const scoredFinal=r=>r?.status==="FINAL"&&r?.team_score!=null&&r?.opponent_score!=null;
const sameScore=(a,b)=>Number(a?.team_score)===Number(b?.team_score)&&Number(a?.opponent_score)===Number(b?.opponent_score);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

function hasParticipantResult(e){
  return participants(e).some(p=>p?.result&&typeof p.result==="object");
}
function hasResultsArray(e){
  return Array.isArray(e?.results)&&e.results.length>0;
}
function legacyScores(e){
  return [
    e?.homeScore,e?.awayScore,e?.visitorScore,
    e?.score?.home,e?.score?.away,
    e?.home?.score,e?.away?.score,
    e?.home_team?.score,e?.away_team?.score
  ].map(num).filter(v=>v!==null);
}
function hasLegacyScores(e){return legacyScores(e).length>0;}
function participantScorePair(e){
  const ps=participants(e);
  if(ps.length<2) return false;
  for(let i=0;i<ps.length;i++){
    const own=num(ps[i]?.result?.score);
    const other=ps.find((_,j)=>j!==i);
    const opp=num(ps[i]?.result?.opponentScore)??num(other?.result?.score);
    if(own!==null&&opp!==null) return true;
  }
  return false;
}
function resultsArrayScorePair(e){
  const rs=Array.isArray(e?.results)?e.results:[];
  if(!rs.length) return false;
  const direct=[];
  for(const r of rs){
    const a=num(r?.score??r?.teamScore??r?.points??r?.value);
    if(a!==null) direct.push(a);
    const h=num(r?.homeScore??r?.home?.score);
    const w=num(r?.awayScore??r?.away?.score);
    if(h!==null&&w!==null) return true;
  }
  return direct.length>=2;
}
function legacyScorePair(e){return legacyScores(e).length>=2;}
function hasAnyScoreStructure(e){
  return hasParticipantResult(e)||hasResultsArray(e)||hasLegacyScores(e);
}
function rawUsableScorePair(e){
  return participantScorePair(e)||resultsArrayScorePair(e)||legacyScorePair(e);
}
function eventMatchesConfig(e,config){
  const sports=Array.isArray(e?.associatedSports)?e.associatedSports:[];
  if(!sports.length) return true;
  return sports.some(item=>{
    const code=clean(item?.code).toUpperCase();
    const level=clean(item?.level).toLowerCase();
    return code===config.providerSportCode&&(!level||level.includes("varsity"));
  });
}
function rawExample(e){
  return {
    event_id:eventId(e),
    date:eventDate(e),
    status:explicitStatus(e)||null,
    participants:participants(e).map(p=>({
      name:clean(p?.name),
      orgShortCode:clean(p?.orgShortCode)||null,
      teamId:clean(p?.team?.teamId)||null,
      result:p?.result??null
    })),
    results:Array.isArray(e?.results)?e.results:null,
    homeScore:e?.homeScore??e?.score?.home??e?.home?.score??null,
    awayScore:e?.awayScore??e?.score?.away??e?.away?.score??null
  };
}

async function auditSport(env,code,now){
  const config=statewideSportConfig(code);
  const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{
    headers:{"user-agent":"LocalBleachersAR-dragonfly-production-compare/2.0","accept":"application/json"}
  });
  const all=Array.isArray(fetched.payload?.schedule)?fetched.payload.schedule:[];
  const schedule=all.filter(e=>eventMatchesConfig(e,config));

  const mappingQuery=await env.DB.prepare(
    "SELECT tei.external_team_id,src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,sch.name AS school_name,sch.latitude,sch.longitude "+
    "FROM team_external_identities tei "+
    "JOIN teams t ON t.id=tei.team_id "+
    "JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local' AND sch.level='high-school' AND sch.state='AR' "+
    "JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' "+
    "WHERE tei.provider=? AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1"
  ).bind(config.teamIdentityProvider,config.sport,config.gender,config.season).all();
  const mappings=mappingQuery.results||[];

  const rows=buildCertifiedStatewideRows(fetched.payload,mappings,config,{checkedAt:now.toISOString()});
  const normalizedFinalObs=rows.games.filter(scoredFinal);
  const normalizedEventKeys=[...new Set(normalizedFinalObs.map(g=>g.source_event_key).filter(Boolean))];
  const normalizedRawIds=new Set(normalizedEventKeys.map(k=>clean(k).replace(/^native:/,"")));

  const rawExplicitFinalUsable=schedule.filter(e=>isExplicitFinal(e)&&rawUsableScorePair(e));
  const rawExplicitFinalIds=[...new Set(rawExplicitFinalUsable.map(eventId).filter(Boolean))];
  const rawExplicitFinalNotNormalized=rawExplicitFinalUsable.filter(e=>!normalizedRawIds.has(safe(eventId(e))));

  const gameQuery=await env.DB.prepare(
    "SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.status,g.team_score,g.opponent_score,g.canonical_event_id,g.last_checked_at "+
    "FROM games g JOIN teams t ON t.id=g.team_id JOIN sources src ON src.id=g.source_id "+
    "WHERE t.active=1 AND t.season=? AND t.sport=? AND t.gender=? "+
    "AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'"
  ).bind(config.season,config.sport,config.gender).all();

  const truthQuery=await env.DB.prepare(
    "SELECT truth_id,team_id,game_id,canonical_event_id,status,team_score,opponent_score,source_id,parser_type,refreshed_at "+
    "FROM ONE_TRUTH_TB WHERE row_type='GAME' AND season=? AND sport=? AND gender=?"
  ).bind(config.season,config.sport,config.gender).all();

  const prodGames=gameQuery.results||[];
  const truth=truthQuery.results||[];
  const prodById=new Map(prodGames.map(r=>[String(r.id),r]));
  const truthByTeam=new Map();
  for(const row of truth){
    const key=String(row.team_id||"");
    if(!truthByTeam.has(key)) truthByTeam.set(key,[]);
    truthByTeam.get(key).push(row);
  }

  const obs=[];
  for(const game of normalizedFinalObs){
    const prod=prodById.get(String(game.id))||null;
    const candidates=truthByTeam.get(String(game.team_id))||[];
    const truthRow=candidates.find(r=>String(r.game_id||"")===String(game.id))
      ||(game.canonical_event_id?candidates.find(r=>String(r.canonical_event_id||"")===String(game.canonical_event_id)):null)
      ||null;
    obs.push({
      event_key:game.source_event_key,
      team_id:game.team_id,
      game_id:game.id,
      canonical_event_id:game.canonical_event_id||null,
      raw_scores:[game.team_score,game.opponent_score],
      d1_ok:Boolean(prod&&scoredFinal(prod)&&sameScore(prod,game)),
      truth_ok:Boolean(truthRow&&scoredFinal(truthRow)&&sameScore(truthRow,game))
    });
  }

  const eventMap=new Map(normalizedEventKeys.map(k=>[k,[]]));
  for(const row of obs) eventMap.get(row.event_key)?.push(row);
  const eventRows=[...eventMap.entries()].map(([event_key,items])=>({
    event_key,
    observations:items.length,
    d1_ok:items.length>0&&items.every(x=>x.d1_ok),
    truth_ok:items.length>0&&items.every(x=>x.truth_ok),
    teams:items.map(x=>x.team_id)
  }));
  const d1Missing=eventRows.filter(x=>!x.d1_ok);
  const truthMissing=eventRows.filter(x=>!x.truth_ok);

  const statusEvents=schedule.filter(e=>Boolean(explicitStatus(e)));
  const participantResultEvents=schedule.filter(hasParticipantResult);
  const resultsArrayEvents=schedule.filter(hasResultsArray);
  const legacyEvents=schedule.filter(hasLegacyScores);
  const scoreStructureEvents=schedule.filter(hasAnyScoreStructure);
  const explicitFinalEvents=schedule.filter(isExplicitFinal);
  const effectiveFinalEvents=schedule.filter(e=>isExplicitFinal(e)||participantScorePair(e)||resultsArrayScorePair(e)||legacyScorePair(e));
  const effectiveFinalUsable=effectiveFinalEvents.filter(rawUsableScorePair);

  return {
    feed_code:config.feedCode,
    sport:config.sport,
    gender:config.gender,
    team_universe:config.expectedTargets,
    pages:fetched.pageCount,
    total_events:schedule.length,
    past_events:schedule.filter(e=>{const t=Date.parse(eventDate(e));return Number.isFinite(t)&&t<now.getTime();}).length,
    explicit_status_events:statusEvents.length,
    explicit_final_complete_events:explicitFinalEvents.length,
    any_score_result_structure_events:scoreStructureEvents.length,
    participant_result_events:participantResultEvents.length,
    results_array_events:resultsArrayEvents.length,
    legacy_home_away_score_events:legacyEvents.length,
    explicit_final_with_both_usable_scores:rawExplicitFinalUsable.length,
    effective_final_with_both_usable_scores:effectiveFinalUsable.length,
    certified_mappings:mappings.length,
    normalized_scored_final_observations:normalizedFinalObs.length,
    normalized_unique_scored_final_events:normalizedEventKeys.length,
    raw_explicit_scored_finals_not_normalized:rawExplicitFinalNotNormalized.length,
    d1:{
      statewide_game_rows:prodGames.length,
      normalized_scored_events_captured:eventRows.length-d1Missing.length,
      normalized_scored_events_missing:d1Missing.length
    },
    one_truth:{
      game_rows:truth.length,
      normalized_scored_events_captured:eventRows.length-truthMissing.length,
      normalized_scored_events_missing:truthMissing.length
    },
    raw_not_normalized_examples:rawExplicitFinalNotNormalized.slice(0,40).map(rawExample),
    d1_missing_examples:d1Missing.slice(0,40),
    one_truth_missing_examples:truthMissing.slice(0,40)
  };
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="GET"||url.pathname!=="/api/dragonfly-raw-production-compare"||request.headers.get("x-audit-token")!==TOKEN){
      return json({error:"not_found"},404);
    }
    const now=new Date();
    const sports={};
    for(const code of TARGETS){
      const result=await auditSport(env,code,now);
      sports[result.feed_code]=result;
    }
    return json({
      audit_version:"dragonfly-raw-production-compare-v2",
      generated_at:now.toISOString(),
      sports,
      rows_written:0
    });
  }
};
NODE

sed -i "s/__AUDIT_TOKEN__/$TOKEN/" "$WRAPPER"
sed -i "s/__TARGET_CODE__/$TARGET/" "$WRAPPER"
node --check "$WRAPPER"

UPLOAD_LOG="$TMPDIR/upload.log"
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_LOG"

API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD_LOG" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
if [ -z "$API" ]; then API="$API_FALLBACK"; fi
echo "DRAGONFLY_COMPARE_PREVIEW_URL=$API"

READY=""
for ATTEMPT in $(seq 1 40); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H "x-audit-token: $TOKEN" -H 'cache-control: no-store' "$API$RUN_PATH" || true)"
  if [ "$READY" = "200" ]; then break; fi
  sleep 3
done
if [ "$READY" != "200" ]; then
  echo "DragonFly comparison preview never became ready: url=$API last_http=$READY" >&2
  exit 1
fi

OUT="$TMPDIR/result.json"
HTTP_STATUS="$(curl -sS --max-time 300 -o "$OUT" -w '%{http_code}' -H "x-audit-token: $TOKEN" -H 'accept: application/json' -H 'cache-control: no-store' "$API$RUN_PATH")"
if [ "$HTTP_STATUS" != "200" ]; then
  echo "DragonFly comparison failed: HTTP $HTTP_STATUS" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(Number(p.rows_written||0)!==0) throw new Error("audit must remain read-only");
if(p.audit_version!=="dragonfly-raw-production-compare-v2") throw new Error("unexpected audit version");
const target={WVB:"WVB_Varsity",MBB:"MBB_Varsity",WBB:"WBB_Varsity"}[process.env.AUDIT_TARGET||"WVB"];
if(!p.sports?.[target]) throw new Error("missing "+target);
console.log("DRAGONFLY_PRODUCTION_COMPARE_SUMMARY="+JSON.stringify(p.sports));
NODE

node - "$OUT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require("fs");
const body=fs.readFileSync(process.argv[2],"utf8");
process.stdout.write(`
const BODY=${JSON.stringify(body)};
export default {async fetch(){return new Response(BODY,{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}};
`);
NODE

SUMMARY_ALIAS="$(AUDIT_TARGET="$TARGET" node - "$OUT" <<'NODE'
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const target=process.env.AUDIT_TARGET||"WVB";
const feed={WVB:"WVB_Varsity",MBB:"MBB_Varsity",WBB:"WBB_Varsity"}[target];
const s=p.sports?.[feed];
if(!s) throw new Error("missing sport summary "+feed);
const vals=[
  s.total_events,
  s.past_events,
  s.explicit_status_events,
  s.explicit_final_complete_events,
  s.any_score_result_structure_events,
  s.participant_result_events,
  s.results_array_events,
  s.legacy_home_away_score_events,
  s.explicit_final_with_both_usable_scores,
  s.normalized_unique_scored_final_events,
  s.normalized_scored_final_observations,
  s.raw_explicit_scored_finals_not_normalized,
  s.certified_mappings,
  s.d1?.normalized_scored_events_missing,
  s.one_truth?.normalized_scored_events_missing
].map(v=>Math.max(0,Number(v)||0).toString(36));
console.log(target.toLowerCase()+"-"+vals.join("-"));
NODE
)"
echo "DRAGONFLY_SUMMARY_ALIAS=$SUMMARY_ALIAS"
RESULT_UPLOAD_LOG="$TMPDIR/result-upload.log"
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$SUMMARY_ALIAS" --keep-vars 2>&1 | tee "$RESULT_UPLOAD_LOG"
echo "DRAGONFLY_PRODUCTION_COMPARE_PUBLISHED=$API$RUN_PATH"
