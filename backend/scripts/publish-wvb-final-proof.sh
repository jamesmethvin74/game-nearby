#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
WVB_PROVIDER="dragonfly:ArkAA:2026:WVB_Varsity"
WBB_PROVIDER="dragonfly:ArkAA:2026:WBB_Varsity"
API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$WVB_PROVIDER' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wvbm.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wvbs.json"
wrangler d1 execute "$DB" --remote --command="SELECT g.id game_id,g.team_id,g.source_id,g.source_event_key,g.opponent,g.opponent_school_id,g.scheduled_at,g.scheduled_time_known,g.venue,g.location_text,g.home_away,g.conference_game,g.counts_for_record,g.status,g.team_score,g.opponent_score,g.result,g.notes,g.source_url,g.canonical_event_id,t.school_id,sch.name school_name,t.sport,t.gender,t.season,src.source_type,src.parser_type,ce.home_school_id canonical_home_school_id,ce.away_school_id canonical_away_school_id,ce.status canonical_status,ce.home_score canonical_home_score,ce.away_score canonical_away_score FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id WHERE g.team_id IN (SELECT DISTINCT team_id FROM team_external_identities WHERE provider='$WVB_PROVIDER')" --json > "$TMPDIR/d1.json"
wrangler d1 execute "$DB" --remote --command="SELECT * FROM ONE_TRUTH_TB WHERE team_id IN (SELECT DISTINCT team_id FROM team_external_identities WHERE provider='$WVB_PROVIDER') AND sport='volleyball' AND gender='girls' AND season='2026'" --json > "$TMPDIR/truth-before.json"
wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$WBB_PROVIDER' AND t.sport='basketball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wbbm.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='basketball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wbbs.json"

API="$API" node --input-type=module - "$TMPDIR" > "$TMPDIR/result.json" <<'NODE'
import fs from "node:fs";
import { fetchDragonFlyPagedPayload } from "./src/dragonfly-feed.js";
import { buildCertifiedStatewideRows, collapseCertifiedProviderDuplicates } from "./src/dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./src/statewide-sport-config.js";
import { scheduleRowsLikelySameLogicalGame, officialSeasonScheduleRows } from "./src/schedule-response-normalizer.js";
import { evaluateFinalResultTruth } from "./src/final-result-truth.js";
import { dateKeyInZone, normalizeSchoolAlias } from "./src/schedule-authority-core.js";

const dir=process.argv[2], API=process.env.API;
const read=f=>{const p=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));return (Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]);};
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const num=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const scored=r=>String(r?.status||"").toUpperCase()==="FINAL"&&num(r?.team_score)!=null&&num(r?.opponent_score)!=null;
const terminal=new Set(["FINAL","CANCELED","POSTPONED","RESULT_PENDING"]);
const score=v=>{if(v==null||v==="")return null;const n=Number(String(v).replace(/[^0-9.-]/g,""));return Number.isFinite(n)?n:null;};
function rawScored(e){const ps=Array.isArray(e?.participants)?e.participants:[];if(ps.length<2)return false;const a=score(ps[0]?.result?.score),b=score(ps[1]?.result?.score),ao=score(ps[0]?.result?.opponentScore),bo=score(ps[1]?.result?.opponentScore);return (a!=null&&b!=null)||(a!=null&&ao!=null)||(b!=null&&bo!=null);}
function eventAt(e){return clean(e?.date||e?.startDateTime||e?.scheduledAt);}
function eventId(e){return clean(e?.eventId||e?.id);}
function logicalKey(r){return String(r?.canonical_event_id||r?.game_id||r?.truth_id||"");}
function resultFrom(r){if(!scored(r))return null;const a=Number(r.team_score),b=Number(r.opponent_score);return a===b?"T":a>b?"W":"L";}

const mappings=read("wvbm.json"), schoolMappings=read("wvbs.json"), d1=read("d1.json"), truth=read("truth-before.json");
const targetIds=new Set(mappings.map(x=>String(x.team_id)));
const cfg=statewideSportConfig("WVB");
const feed=await fetchDragonFlyPagedPayload(cfg.feedUrl,{headers:{"user-agent":"LocalBleachersAR-final-wvb-proof/1.0","accept":"application/json"}});
const schedule=Array.isArray(feed.payload?.schedule)?feed.payload.schedule:[];
const rawScoredEvents=schedule.filter(rawScored);
const preOfficialRaw=rawScoredEvents.filter(e=>dateKeyInZone(eventAt(e),"America/Chicago")<"2026-08-24");
const collapsedScored=collapseCertifiedProviderDuplicates(schedule,cfg).filter(rawScored);
const built=buildCertifiedStatewideRows(feed.payload,mappings,cfg,{schoolMappings,checkedAt:new Date().toISOString()});
const normalizedOfficial=built.games.filter(r=>scored(r)&&Number(r.counts_for_record??1)!==0&&targetIds.has(String(r.team_id)));
const normalizedKeys=new Set(normalizedOfficial.map(r=>String(r.source_event_key||"")).filter(Boolean));
const normalizedCoverage=new Set(normalizedOfficial.map(r=>String(r.team_id)));

const d1Official=d1.filter(r=>scored(r)&&Number(r.counts_for_record??1)!==0&&targetIds.has(String(r.team_id))&&String(r.parser_type)==="dragonfly-public");
const d1Keys=new Set(d1Official.map(r=>String(r.source_event_key||"")).filter(Boolean));
const d1Coverage=new Set(d1Official.map(r=>String(r.team_id)));
const d1ByKey=new Map();
for(const r of d1Official){const k=String(r.source_event_key||"");if(!d1ByKey.has(k))d1ByKey.set(k,[]);d1ByKey.get(k).push(r);}
const d1CaptureOk=[...normalizedKeys].every(k=>d1ByKey.has(k));

const truthGames=truth.filter(r=>r.row_type==="GAME"&&targetIds.has(String(r.team_id)));
const truthOfficial=truthGames.filter(r=>scored(r)&&Number(r.counts_for_record??1)!==0);
const truthCoverage=new Set(truthOfficial.map(r=>String(r.team_id)));
const truthLogical=new Set(truthOfficial.map(logicalKey).filter(Boolean));
const truthByTeam=new Map();
for(const r of truthOfficial){const k=String(r.team_id);if(!truthByTeam.has(k))truthByTeam.set(k,[]);truthByTeam.get(k).push(r);}
let represented=0;
for(const k of normalizedKeys){
  const rows=d1ByKey.get(k)||[];
  let ok=false;
  for(const d of rows){
    const candidates=truthByTeam.get(String(d.team_id))||[];
    if(candidates.some(t=>String(t.game_id||"")===String(d.game_id||"")||(d.canonical_event_id&&String(t.canonical_event_id||"")===String(d.canonical_event_id)))){ok=true;break;}
    if(candidates.some(t=>scheduleRowsLikelySameLogicalGame(t,d,{reportingSchoolId:d.school_id,maxMinutes:5})&&Number(t.team_score)===Number(d.team_score)&&Number(t.opponent_score)===Number(d.opponent_score))){ok=true;break;}
  }
  if(ok)represented++;
}
const truthRepresentationOk=represented===normalizedKeys.size;

const dragonflyNoCoverage=[...targetIds].filter(id=>!normalizedCoverage.has(id));
const appNoCoverage=[...targetIds].filter(id=>!truthCoverage.has(id));

const officialTruth=officialSeasonScheduleRows(truthGames);
let duplicateLogical=0,splitCanonical=0,staleTwin=0,contradictory=0;
const byTeam=new Map();
for(const r of officialTruth){const k=String(r.team_id);if(!byTeam.has(k))byTeam.set(k,[]);byTeam.get(k).push(r);}
for(const rows of byTeam.values()){
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j];
    if(!scheduleRowsLikelySameLogicalGame(a,b,{reportingSchoolId:a.school_id,maxMinutes:5}))continue;
    duplicateLogical++;
    const ac=clean(a.canonical_event_id),bc=clean(b.canonical_event_id);
    if(ac&&bc&&ac!==bc)splitCanonical++;
    const af=scored(a),bf=scored(b),an=!terminal.has(String(a.status||"").toUpperCase()),bn=!terminal.has(String(b.status||"").toUpperCase());
    if((af&&bn)||(bf&&an))staleTwin++;
    if(af&&bf&&(Number(a.team_score)!==Number(b.team_score)||Number(a.opponent_score)!==Number(b.opponent_score)))contradictory++;
  }
}
const missingScore=officialTruth.filter(r=>String(r.status||"").toUpperCase()==="FINAL"&&(num(r.team_score)==null||num(r.opponent_score)==null)).length;
const grace=Date.now()-6*3600000;
const overdue=officialTruth.filter(r=>{const t=Date.parse(r.scheduled_at||"");return Number.isFinite(t)&&t<grace&&!terminal.has(String(r.status||"").toUpperCase());}).length;
const quarantined=officialTruth.filter(r=>String(r.status||"").toUpperCase()==="FINAL"&&evaluateFinalResultTruth(r).state==="QUARANTINED").length;

const summaries=new Map(truth.filter(r=>r.row_type==="TEAM").map(r=>[String(r.team_id),r]));
let recordMismatch=0;
for(const id of targetIds){
  const s=summaries.get(id);if(!s){recordMismatch++;continue;}
  const games=truthOfficial.filter(r=>String(r.team_id)===id);
  let w=0,l=0,t=0;
  for(const g of games){const rr=clean(g.result||resultFrom(g)).toUpperCase();if(rr==="W")w++;else if(rr==="L")l++;else if(rr==="T")t++;}
  if(Number(s.overall_wins||0)!==w||Number(s.overall_losses||0)!==l||Number(s.overall_ties||0)!==t)recordMismatch++;
}

const direct=new Map(mappings.map(m=>[clean(m.external_team_id),m])), uniqueSchool=new Map(),amb=new Set();
for(const m of schoolMappings){const k=clean(m.external_school_id).toUpperCase();if(!k||amb.has(k))continue;if(uniqueSchool.has(k)&&uniqueSchool.get(k).team_id!==m.team_id){uniqueSchool.delete(k);amb.add(k);}else uniqueSchool.set(k,m);}
const fallback=[];
for(const e of schedule){
  if(dateKeyInZone(eventAt(e),"America/Chicago")<"2026-08-24"||!rawScored(e))continue;
  const ps=Array.isArray(e?.participants)?e.participants:[];
  for(const p of ps){const teamId=clean(p?.team?.teamId);if(teamId&&direct.has(teamId))continue;const org=clean(p?.orgShortCode).toUpperCase(),m=uniqueSchool.get(org);if(!m)continue;const key=eventId(e)+"|"+m.team_id;if(fallback.some(x=>x.key===key))continue;fallback.push({key,event_id:eventId(e),team_id:m.team_id,school_id:m.school_id,school_name:m.school_name,org_short_code:org});}
}
let appOk=0,appDup=0,recordOk=0,standingsOk=0;
for(const f of fallback){
  const safe=f.event_id.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const ng=normalizedOfficial.find(g=>String(g.team_id)===String(f.team_id)&&String(g.source_event_key||"")===`native:${safe}`);
  const dr=ng?(d1ByKey.get(ng.source_event_key)||[]).find(x=>String(x.team_id)===String(f.team_id)):null;
  const [sr,rr]=await Promise.all([
    fetch(`${API}/api/v1/teams/${encodeURIComponent(f.team_id)}/schedule`,{headers:{"cache-control":"no-store"}}),
    fetch(`${API}/api/v1/teams/${encodeURIComponent(f.team_id)}/record`,{headers:{"cache-control":"no-store"}})
  ]);
  const sb=await sr.json().catch(()=>({})), rb=await rr.json().catch(()=>({}));
  const games=Array.isArray(sb.games)?sb.games:[];
  const exact=games.filter(g=>{
    if(dr?.canonical_event_id&&String(g.canonical_event_id||g.canonicalEventId||"")===String(dr.canonical_event_id))return true;
    return ng&&String(g.game_id||g.id||"")===String(ng.id);
  });
  const ag=exact[0];
  const agTeam=num(ag?.team_score??ag?.teamScore),agOpp=num(ag?.opponent_score??ag?.opponentScore);
  if(sr.status===200&&rr.status===200&&exact.length===1&&String(ag?.status||"").toUpperCase()==="FINAL"&&agTeam===Number(ng?.team_score)&&agOpp===Number(ng?.opponent_score))appOk++;
  if(exact.length>1)appDup+=exact.length-1;
  const summary=summaries.get(String(f.team_id));
  const appRecord=rb?.record?.overall_record??rb?.record?.overallRecord??null;
  if(summary&&String(appRecord||"")===String(summary.overall_record||""))recordOk++;
  if(summary?.conference_id){
    const st=await fetch(`${API}/api/v1/standings?sport=volleyball&conference=${encodeURIComponent(summary.conference_id)}`,{headers:{"cache-control":"no-store"}});
    const body=await st.json().catch(()=>({}));
    const row=(Array.isArray(body.standings)?body.standings:[]).find(x=>String(x.team_id)===String(f.team_id));
    if(st.status===200&&row&&String(row.overall_record||"")===String(summary.overall_record||"")&&String(row.conference_record||"")===String(summary.conference_record||""))standingsOk++;
  } else standingsOk++;
}

const wbbCfg=statewideSportConfig("WBB"), wbbMappings=read("wbbm.json"), wbbSchools=read("wbbs.json");
const wbbFeed=await fetchDragonFlyPagedPayload(wbbCfg.feedUrl,{headers:{"user-agent":"LocalBleachersAR-wbb-gap-proof/1.0","accept":"application/json"}});
const wbbBuilt=buildCertifiedStatewideRows(wbbFeed.payload,wbbMappings,wbbCfg,{schoolMappings:wbbSchools,checkedAt:new Date().toISOString()});
const wbbMappedIds=new Set(wbbMappings.map(x=>String(x.team_id))),wbbScheduledIds=new Set(wbbBuilt.games.map(x=>String(x.team_id)));
const wbbMissing=[...wbbMappedIds].filter(id=>!wbbScheduledIds.has(id));
const wbbMissingRow=wbbMappings.find(x=>String(x.team_id)===String(wbbMissing[0]))||{};
const wbbOrgIds=new Set(wbbSchools.filter(x=>String(x.team_id)===String(wbbMissing[0])).map(x=>clean(x.external_school_id).toUpperCase()));
const rawWbbParticipants=(wbbFeed.payload?.schedule||[]).flatMap(e=>Array.isArray(e?.participants)?e.participants:[]);
const wbbName=normalizeSchoolAlias(wbbMissingRow.school_name);
const wbbAlt=rawWbbParticipants.some(p=>wbbOrgIds.has(clean(p?.orgShortCode).toUpperCase())||normalizeSchoolAlias(p?.name)===wbbName);
const result={
 raw_scored_all:rawScoredEvents.length,preofficial_raw_scored:preOfficialRaw.length,collapsed_scored_all:collapsedScored.length,
 normalized_unique_official:normalizedKeys.size,normalized_observations_official:normalizedOfficial.length,normalized_coverage:normalizedCoverage.size,
 d1_unique_official:d1Keys.size,d1_capture_ok:d1CaptureOk,d1_coverage:d1Coverage.size,
 truth_logical_official:truthLogical.size,truth_representation_ok:truthRepresentationOk,truth_coverage:truthCoverage.size,
 dragonfly_no_coverage:dragonflyNoCoverage,app_no_coverage:appNoCoverage,
 quality:{duplicateLogical,splitCanonical,staleTwin,contradictory,missingScore,overdue,quarantined,recordMismatch},
 fallback,app:{ok:appOk,duplicates:appDup,record_ok:recordOk,standings_ok:standingsOk},
 wbb:{mapped:wbbMappedIds.size,scheduled:wbbScheduledIds.size,missing:wbbMissing,missing_school_id:wbbMissingRow.school_id||null,missing_school_name:wbbMissingRow.school_name||null,reason:wbbAlt?"alternate_identity_or_gap":"schedule_not_published"}
};
console.log(JSON.stringify(result));
NODE

wrangler d1 execute "$DB" --remote --command="SELECT team_id,truth_generation,refreshed_at FROM ONE_TRUTH_TB WHERE row_type='TEAM' AND team_id IN (SELECT DISTINCT team_id FROM team_external_identities WHERE provider='$WVB_PROVIDER')" --json > "$TMPDIR/truth-after.json"

ALIAS="$(node - "$TMPDIR/result.json" "$TMPDIR/truth-before.json" "$TMPDIR/truth-after.json" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const unpack=f=>{const x=JSON.parse(fs.readFileSync(f,"utf8"));return (Array.isArray(x)?x:[x]).flatMap(y=>y?.results||[]);};
const before=unpack(process.argv[3]).filter(x=>x.row_type==="TEAM"),after=unpack(process.argv[4]);
const bm=new Map(before.map(x=>[String(x.team_id),String(x.truth_generation)+"|"+String(x.refreshed_at)]));
const noWrite=after.every(x=>bm.get(String(x.team_id))===String(x.truth_generation)+"|"+String(x.refreshed_at));
const q=p.quality;
const flags=[q.duplicateLogical,q.splitCanonical,q.staleTwin,q.contradictory,q.missingScore,q.overdue,q.quarantined,q.recordMismatch].map(x=>Number(x)>0?1:0);
const fields=[
 [p.raw_scored_all,12],[p.preofficial_raw_scored,8],[p.collapsed_scored_all,12],[p.normalized_unique_official,12],[p.normalized_observations_official,13],
 [p.normalized_coverage,8],[p.d1_unique_official,12],[p.d1_capture_ok?1:0,1],[p.d1_coverage,8],[p.truth_logical_official,12],[p.truth_representation_ok?1:0,1],[p.truth_coverage,8],
 [p.dragonfly_no_coverage.length,3],[p.app_no_coverage.length,3],...flags.map(v=>[v,1]),
 [p.app.ok,2],[p.app.duplicates,2],[p.app.record_ok,2],[p.app.standings_ok,2],[noWrite?1:0,1],
 [p.wbb.mapped,9],[p.wbb.scheduled,9],[p.wbb.missing.length,2],[p.wbb.reason==="schedule_not_published"?0:1,1]
];
let packed=0n;for(const [raw,bits] of fields){const v=BigInt(Math.max(0,Number(raw)||0)),max=(1n<<BigInt(bits))-1n;if(v>max)throw new Error("overflow "+raw+"/"+bits);packed=(packed<<BigInt(bits))|v;}
const name=String(p.wbb.missing_school_name||"none").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,4)||"none";
const alias="v"+packed.toString(36)+"-"+name;if(alias.length>35)throw new Error("alias too long "+alias.length+" "+alias);console.log(alias);
NODE
)"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "WVB_FINAL_PROOF_ALIAS=$ALIAS"
