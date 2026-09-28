#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
WVB_PROVIDER="dragonfly:ArkAA:2026:WVB_Varsity"
WBB_PROVIDER="dragonfly:ArkAA:2026:WBB_Varsity"
TMPDIR="$(mktemp -d)"; trap 'rm -rf "$TMPDIR"' EXIT
wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$WVB_PROVIDER' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wvbm.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wvbs.json"
wrangler d1 execute "$DB" --remote --command="SELECT g.id game_id,g.team_id,g.source_id,g.source_event_key,g.opponent,g.opponent_school_id,g.scheduled_at,g.scheduled_time_known,g.venue,g.location_text,g.home_away,g.conference_game,g.counts_for_record,g.status,g.team_score,g.opponent_score,g.result,g.notes,g.source_url,g.canonical_event_id,t.school_id,sch.name school_name,t.sport,t.gender,t.season,src.source_type,src.parser_type FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id WHERE g.team_id IN (SELECT DISTINCT team_id FROM team_external_identities WHERE provider='$WVB_PROVIDER') AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'" --json > "$TMPDIR/d1.json"
wrangler d1 execute "$DB" --remote --command="SELECT * FROM ONE_TRUTH_TB WHERE team_id IN (SELECT DISTINCT team_id FROM team_external_identities WHERE provider='$WVB_PROVIDER') AND sport='volleyball' AND gender='girls' AND season='2026'" --json > "$TMPDIR/truth.json"
wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$WBB_PROVIDER' AND t.sport='basketball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wbbm.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='basketball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wbbs.json"

node --input-type=module - "$TMPDIR" > "$TMPDIR/out.json" <<'NODE'
import fs from "node:fs";
import { fetchDragonFlyPagedPayload } from "./src/dragonfly-feed.js";
import { buildCertifiedStatewideRows } from "./src/dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./src/statewide-sport-config.js";
import { resultEvidenceMatchesScheduleRow, scheduleRowsLikelyDuplicate } from "./src/schedule-response-normalizer.js";
import { normalizeSchoolAlias } from "./src/schedule-authority-core.js";
const dir=process.argv[2];
const rows=f=>{const p=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));return (Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]);};
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const scored=r=>String(r?.status||"").toUpperCase()==="FINAL"&&r?.team_score!=null&&r?.opponent_score!=null&&Number(r?.counts_for_record??1)!==0;
const maps=rows("wvbm.json"),schools=rows("wvbs.json"),d1=rows("d1.json"),truth=rows("truth.json");
const cfg=statewideSportConfig("WVB"),feed=await fetchDragonFlyPagedPayload(cfg.feedUrl,{headers:{"user-agent":"LocalBleachersAR-dedupe-proof/1.0","accept":"application/json"}});
const built=buildCertifiedStatewideRows(feed.payload,maps,cfg,{schoolMappings:schools,checkedAt:new Date().toISOString()});
const expected=built.games.filter(scored);
const targetIds=new Set(maps.map(x=>String(x.team_id)));
const normalizedCoverage=new Set(expected.map(x=>String(x.team_id)));
const noCoverage=[...targetIds].filter(id=>!normalizedCoverage.has(id)).map(id=>maps.find(x=>String(x.team_id)===id)).filter(Boolean);
const d1ById=new Map(d1.map(x=>[String(x.game_id),x])), truthByTeam=new Map();
for(const t of truth.filter(x=>x.row_type==="GAME")){const k=String(t.team_id);if(!truthByTeam.has(k))truthByTeam.set(k,[]);truthByTeam.get(k).push(t);}
const obs=[];
for(const e of expected){
 const d=d1ById.get(String(e.id));
 if(!d){obs.push({event:String(e.source_event_key),state:"unmatched"});continue;}
 const candidates=truthByTeam.get(String(e.team_id))||[];
 const sameScore=t=>String(t.status||"").toUpperCase()==="FINAL"&&Number(t.team_score)===Number(d.team_score)&&Number(t.opponent_score)===Number(d.opponent_score);
 const exact=candidates.find(t=>(String(t.game_id||"")===String(d.game_id)||(d.canonical_event_id&&String(t.canonical_event_id||"")===String(d.canonical_event_id)))&&sameScore(t));
 if(exact){obs.push({event:String(e.source_event_key),state:"exact"});continue;}
 const logical=candidates.find(t=>sameScore(t)&&(resultEvidenceMatchesScheduleRow(t,d,{reportingSchoolId:d.school_id})||scheduleRowsLikelyDuplicate(t,d,{reportingSchoolId:d.school_id})));
 obs.push({event:String(e.source_event_key),state:logical?"logical":"unmatched"});
}
const byEvent=new Map();
for(const o of obs){if(!byEvent.has(o.event))byEvent.set(o.event,[]);byEvent.get(o.event).push(o.state);}
let exactEvents=0,logicalEvents=0,unexplainedEvents=0;
for(const states of byEvent.values()){if(states.every(s=>s==="exact"))exactEvents++;else if(states.every(s=>s!=="unmatched"))logicalEvents++;else unexplainedEvents++;}
const exactObs=obs.filter(x=>x.state==="exact").length,logicalObs=obs.filter(x=>x.state==="logical").length,unmatchedObs=obs.filter(x=>x.state==="unmatched").length;

const wbbCfg=statewideSportConfig("WBB"),wbbMaps=rows("wbbm.json"),wbbSchools=rows("wbbs.json"),wbbFeed=await fetchDragonFlyPagedPayload(wbbCfg.feedUrl,{headers:{"user-agent":"LocalBleachersAR-wbb-name-proof/1.0","accept":"application/json"}});
const wbbBuilt=buildCertifiedStatewideRows(wbbFeed.payload,wbbMaps,wbbCfg,{schoolMappings:wbbSchools,checkedAt:new Date().toISOString()});
const sched=new Set(wbbBuilt.games.map(x=>String(x.team_id))),mapped=new Set(wbbMaps.map(x=>String(x.team_id)));
const missing=[...mapped].filter(id=>!sched.has(id));const wm=wbbMaps.find(x=>String(x.team_id)===String(missing[0]))||{};
const rawP=(wbbFeed.payload?.schedule||[]).flatMap(e=>Array.isArray(e?.participants)?e.participants:[]);
const orgs=new Set(wbbSchools.filter(x=>String(x.team_id)===String(missing[0])).map(x=>clean(x.external_school_id).toUpperCase()));
const alt=rawP.some(p=>orgs.has(clean(p?.orgShortCode).toUpperCase())||normalizeSchoolAlias(p?.name)===normalizeSchoolAlias(wm.school_name));
console.log(JSON.stringify({exactEvents,logicalEvents,unexplainedEvents,exactObs,logicalObs,unmatchedObs,noCoverage,wbb:{missing,school_name:wm.school_name,school_id:wm.school_id,reason:alt?"alternate_identity_or_gap":"schedule_not_published"}}));
NODE

ALIAS="$(node - "$TMPDIR/out.json" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const fields=[[p.exactEvents,12],[p.logicalEvents,12],[p.unexplainedEvents,10],[p.exactObs,13],[p.logicalObs,12],[p.unmatchedObs,10],[p.noCoverage.length,3]];
let packed=0n;for(const [raw,bits] of fields){const v=BigInt(Math.max(0,Number(raw)||0));packed=(packed<<BigInt(bits))|v;}
const slug=x=>String(x||"none").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,6)||"none";
const n1=slug(p.noCoverage[0]?.school_name).slice(0,6),n2=slug(p.noCoverage[1]?.school_name).slice(0,6),wb=slug(p.wbb.school_name).slice(0,5);
const alias="c"+packed.toString(36)+"-"+n1+"-"+n2+"-"+wb;if(alias.length>35)throw new Error("alias too long "+alias.length+" "+alias);console.log(alias);
NODE
)"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "WVB_DEDUPE_ALIAS=$ALIAS"
