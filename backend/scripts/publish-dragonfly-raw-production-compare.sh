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

cleanup() {
  rm -f "$WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT INT TERM

node - "$TOKEN" > "$WRAPPER" <<'NODE'
const [token] = process.argv.slice(2);
process.stdout.write(`
import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { buildCertifiedStatewideRows } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";

const TOKEN=${JSON.stringify(token)};
const clean=v=>String(v??"").replace(/\\s+/g," ").trim();
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function scoredFinal(row){return row?.status==="FINAL" && row?.team_score!=null && row?.opponent_score!=null;}
function sameScore(a,b){return Number(a?.team_score)===Number(b?.team_score) && Number(a?.opponent_score)===Number(b?.opponent_score);}
function eventIdFromKey(key){return clean(key).replace(/^native:/,"");}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="GET" || url.pathname!=="/api/dragonfly-raw-production-compare" || request.headers.get("x-audit-token")!==TOKEN){
      return json({error:"not_found"},404);
    }
    const config=statewideSportConfig("WVB_Varsity");
    const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{
      headers:{"user-agent":"LocalBleachersAR-dragonfly-production-compare/1.0","accept":"application/json"}
    });

    const mappingQuery=await env.DB.prepare(`
      SELECT tei.external_team_id,src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,
             sch.name AS school_name,sch.latitude,sch.longitude
      FROM team_external_identities tei
      JOIN teams t ON t.id=tei.team_id
      JOIN schools sch ON sch.id=t.school_id
        AND sch.catalog_scope='local' AND sch.level='high-school' AND sch.state='AR'
      JOIN sources src ON src.team_id=t.id
        AND src.parser_type='dragonfly-public'
        AND src.collection_mode='statewide'
        AND src.id=t.id || '-dragonfly-statewide'
      WHERE tei.provider=? AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1
    `).bind(config.teamIdentityProvider,config.sport,config.gender,config.season).all();

    const mappings=mappingQuery.results||[];
    const rows=buildCertifiedStatewideRows(fetched.payload,mappings,config,{checkedAt:new Date().toISOString()});
    const expected=rows.games.filter(scoredFinal);
    const rawEventKeys=[...new Set(expected.map(g=>g.source_event_key).filter(Boolean))];

    const gameQuery=await env.DB.prepare(`
      SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.status,g.team_score,g.opponent_score,
             g.canonical_event_id,g.last_checked_at
      FROM games g
      JOIN teams t ON t.id=g.team_id
      JOIN sources src ON src.id=g.source_id
      WHERE t.active=1 AND t.season=? AND t.sport='volleyball' AND t.gender='girls'
        AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'
    `).bind(config.season).all();

    const truthQuery=await env.DB.prepare(`
      SELECT truth_id,team_id,game_id,canonical_event_id,status,team_score,opponent_score,
             source_id,parser_type,refreshed_at
      FROM ONE_TRUTH_TB
      WHERE row_type='GAME' AND season=? AND sport='volleyball' AND gender='girls'
    `).bind(config.season).all();

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
    for(const game of expected){
      const prod=prodById.get(String(game.id))||null;
      const candidates=truthByTeam.get(String(game.team_id))||[];
      const truthRow=candidates.find(r=>String(r.game_id||"")===String(game.id))
        || (game.canonical_event_id ? candidates.find(r=>String(r.canonical_event_id||"")===String(game.canonical_event_id)) : null)
        || null;
      obs.push({
        event_key:game.source_event_key,
        event_id:eventIdFromKey(game.source_event_key),
        team_id:game.team_id,
        game_id:game.id,
        canonical_event_id:game.canonical_event_id||null,
        raw_scores:[game.team_score,game.opponent_score],
        d1_ok:Boolean(prod && scoredFinal(prod) && sameScore(prod,game)),
        d1_row:prod?{status:prod.status,team_score:prod.team_score,opponent_score:prod.opponent_score,last_checked_at:prod.last_checked_at}:null,
        truth_ok:Boolean(truthRow && scoredFinal(truthRow) && sameScore(truthRow,game)),
        truth_row:truthRow?{truth_id:truthRow.truth_id,game_id:truthRow.game_id,canonical_event_id:truthRow.canonical_event_id,status:truthRow.status,team_score:truthRow.team_score,opponent_score:truthRow.opponent_score,source_id:truthRow.source_id,parser_type:truthRow.parser_type,refreshed_at:truthRow.refreshed_at}:null
      });
    }

    const eventMap=new Map(rawEventKeys.map(k=>[k,[]]));
    for(const row of obs) eventMap.get(row.event_key)?.push(row);
    const eventRows=[...eventMap.entries()].map(([event_key,items])=>({
      event_key,
      event_id:eventIdFromKey(event_key),
      observations:items.length,
      d1_ok:items.every(x=>x.d1_ok),
      truth_ok:items.every(x=>x.truth_ok),
      teams:items.map(x=>x.team_id)
    }));
    const d1Missing=eventRows.filter(x=>!x.d1_ok);
    const truthMissing=eventRows.filter(x=>!x.truth_ok);

    const rawSet=new Set(rawEventKeys);
    const staleD1=prodGames.filter(scoredFinal).filter(r=>!rawSet.has(String(r.source_event_key||"")));
    const staleTruthDragonFly=truth.filter(scoredFinal).filter(r=>String(r.parser_type||"")==="dragonfly-public").filter(r=>{
      const id=String(r.game_id||"");
      const marker=id.lastIndexOf(":native:");
      if(marker<0) return false;
      return !rawSet.has("native:"+id.slice(marker+8));
    });

    return json({
      audit_version:"dragonfly-raw-production-compare-v1",
      generated_at:new Date().toISOString(),
      sport:"WVB_Varsity",
      raw_pages:fetched.pageCount,
      raw_total_events:Array.isArray(fetched.payload?.schedule)?fetched.payload.schedule.length:0,
      certified_mappings:mappings.length,
      normalized_scored_final_observations:expected.length,
      normalized_unique_scored_final_events:rawEventKeys.length,
      d1:{
        statewide_game_rows:prodGames.length,
        raw_scored_events_captured:eventRows.length-d1Missing.length,
        raw_scored_events_missing:d1Missing.length,
        stale_scored_final_observations_vs_current_raw:staleD1.length
      },
      one_truth:{
        volleyball_game_rows:truth.length,
        raw_scored_events_captured:eventRows.length-truthMissing.length,
        raw_scored_events_missing:truthMissing.length,
        stale_dragonfly_scored_final_rows_vs_current_raw:staleTruthDragonFly.length
      },
      d1_missing_examples:d1Missing.slice(0,50).map(e=>({...e,details:obs.filter(o=>o.event_key===e.event_key&&!o.d1_ok)})),
      one_truth_missing_examples:truthMissing.slice(0,50).map(e=>({...e,details:obs.filter(o=>o.event_key===e.event_key&&!o.truth_ok)})),
      stale_d1_examples:staleD1.slice(0,50),
      stale_truth_examples:staleTruthDragonFly.slice(0,50),
      rows_written:0
    });
  }
};
`);
NODE

UPLOAD_LOG="$TMPDIR/upload.log"
wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars 2>&1 | tee "$UPLOAD_LOG"
API="$(grep -Eo 'https://[A-Za-z0-9.-]+\\.workers\\.dev' "$UPLOAD_LOG" | grep -m1 "https://${ALIAS}-${WORKER}\\." || true)"
if [ -z "$API" ]; then API="$API_FALLBACK"; fi
echo "DRAGONFLY_COMPARE_PREVIEW_URL=$API"

OUT="$TMPDIR/result.json"
HTTP_STATUS="$(curl -sS --retry 3 --max-time 300 -o "$OUT" -w '%{http_code}' -H "x-audit-token: $TOKEN" -H 'accept: application/json' "$API$RUN_PATH")"
if [ "$HTTP_STATUS" != "200" ]; then cat "$OUT" >&2 || true; exit 1; fi

node - "$OUT" <<'NODE'
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(Number(p.rows_written||0)!==0) throw new Error("audit must remain read-only");
if(!p.audit_version) throw new Error("missing audit version");
console.log("DRAGONFLY_PRODUCTION_COMPARE_SUMMARY="+JSON.stringify({
  normalized_unique_scored_final_events:p.normalized_unique_scored_final_events,
  normalized_scored_final_observations:p.normalized_scored_final_observations,
  d1:p.d1,
  one_truth:p.one_truth
}));
NODE

node - "$OUT" > "$RESULT_WRAPPER" <<'NODE'
const fs=require("fs");
const body=fs.readFileSync(process.argv[2],"utf8");
process.stdout.write(`
const BODY=${JSON.stringify(body)};
export default {async fetch(){return new Response(BODY,{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}};
`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "DRAGONFLY_PRODUCTION_COMPARE_PUBLISHED=$API$RUN_PATH"
