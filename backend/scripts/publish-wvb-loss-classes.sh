#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
PROVIDER="dragonfly:ArkAA:2026:WVB_Varsity"
TMPDIR="$(mktemp -d)"; trap 'rm -rf "$TMPDIR"' EXIT
wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$PROVIDER' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/maps.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/schools.json"
wrangler d1 execute "$DB" --remote --command="SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.status,g.team_score,g.opponent_score,g.result,g.opponent,g.opponent_school_id,g.scheduled_at,g.scheduled_time_known,g.venue,g.location_text,g.home_away,g.conference_game,g.counts_for_record,g.canonical_event_id,g.notes,g.updated_at,g.last_checked_at,src.last_successful_fetch_at,ce.status canonical_status,ce.home_score canonical_home_score,ce.away_score canonical_away_score,ce.trust_state canonical_trust_state,ce.conflict_count canonical_conflict_count,t.school_id,t.sport,t.gender,t.season,sch.name school_name,sch.level school_level,src.source_type,src.parser_type FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id WHERE g.team_id IN (SELECT DISTINCT team_id FROM team_external_identities WHERE provider='$PROVIDER') AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide'" --json > "$TMPDIR/d1.json"
wrangler d1 execute "$DB" --remote --command="SELECT * FROM ONE_TRUTH_TB WHERE team_id IN (SELECT DISTINCT team_id FROM team_external_identities WHERE provider='$PROVIDER') AND sport='volleyball' AND gender='girls' AND season='2026'" --json > "$TMPDIR/truth.json"

node --input-type=module - "$TMPDIR" > "$TMPDIR/out.json" <<'NODE'
import fs from "node:fs";
import { fetchDragonFlyPagedPayload } from "./src/dragonfly-feed.js";
import { buildCertifiedStatewideRows } from "./src/dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./src/statewide-sport-config.js";
import { rowIsOfficialSeasonContest, resultEvidenceMatchesScheduleRow, scheduleRowsLikelyDuplicate } from "./src/schedule-response-normalizer.js";
import { dateKeyInZone } from "./src/schedule-authority-core.js";
import { evaluateFinalResultTruth } from "./src/final-result-truth.js";
const dir=process.argv[2];
const rows=f=>{const p=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));return (Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]);};
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const scoredFinal=g=>String(g?.status||"").toUpperCase()==="FINAL"&&g?.team_score!=null&&g?.opponent_score!=null;
const sameScore=(a,b)=>Number(a?.team_score)===Number(b?.team_score)&&Number(a?.opponent_score)===Number(b?.opponent_score);
const cfg=statewideSportConfig("WVB"),maps=rows("maps.json"),schools=rows("schools.json"),d1=rows("d1.json"),truth=rows("truth.json");
const feed=await fetchDragonFlyPagedPayload(cfg.feedUrl,{headers:{"user-agent":"LocalBleachersAR-loss-class/1.0","accept":"application/json"}});
const built=buildCertifiedStatewideRows(feed.payload,maps,cfg,{schoolMappings:schools,checkedAt:new Date().toISOString()});
const normalizedFinals=built.games.filter(scoredFinal);
const prodById=new Map(d1.map(r=>[String(r.id),r])),truthByTeam=new Map(),teamSummary=new Map();
for(const r of truth){if(r.row_type==="TEAM")teamSummary.set(String(r.team_id),r);else if(r.row_type==="GAME"){const k=String(r.team_id);if(!truthByTeam.has(k))truthByTeam.set(k,[]);truthByTeam.get(k).push(r);}}
const truthCandidate=r=>({id:r.game_id||r.truth_id,team_id:r.team_id,canonical_event_id:r.canonical_event_id||null,sport:"volleyball",gender:"girls",season:"2026",status:r.status,team_score:r.team_score,opponent_score:r.opponent_score,result:r.result||null,opponent:r.opponent||"",opponent_school_id:r.opponent_school_id||null,scheduled_at:r.scheduled_at,scheduled_time_known:Number(r.scheduled_time_known??1),source_id:r.source_id,source_type:r.source_type,parser_type:r.parser_type,counts_for_record:Number(r.counts_for_record??1)});
const classes=["suppressed","canonical_incomplete_overrides_raw_final","pre_official_filter","other_official_filter","logical_duplicate_same_final","logical_duplicate_conflict","truth_present_wrong_status_or_score","stale_truth","other"];
const obsCounts=Object.fromEntries(classes.map(x=>[x,0])),eventCounts=Object.fromEntries(classes.map(x=>[x,0]));
const missing=[];
for(const expected of normalizedFinals){
 const d=prodById.get(String(expected.id));if(!d){missing.push({event_key:expected.source_event_key,class:"other"});obsCounts.other++;continue;}
 const candidates=truthByTeam.get(String(expected.team_id))||[];
 const truthRow=candidates.find(r=>String(r.game_id||"")===String(expected.id))||(d.canonical_event_id?candidates.find(r=>String(r.canonical_event_id||"")===String(d.canonical_event_id)):null)||null;
 if(truthRow&&scoredFinal(truthRow)&&sameScore(truthRow,expected))continue;
 const canonicalScored=clean(d.canonical_status).toUpperCase()==="FINAL"&&d.canonical_home_score!=null&&d.canonical_away_score!=null;
 const canonicalIncomplete=Boolean(d.canonical_event_id)&&!canonicalScored;
 const suppressed=clean(d.notes).includes("Excluded from current LocalBleachers presentation")||clean(d.notes).includes("Removed from current statewide DragonFly schedule");
 const c={id:d.id,team_id:d.team_id,school_id:d.school_id,level:d.school_level,sport:d.sport,gender:d.gender,season:d.season,parser_type:d.parser_type,source_type:d.source_type,source_id:d.source_id,counts_for_record:Number(d.counts_for_record??1),notes:d.notes,opponent:d.opponent,opponent_school_id:d.opponent_school_id,venue:d.venue,location_text:d.location_text,scheduled_at:d.scheduled_at,scheduled_time_known:Number(d.scheduled_time_known??1),canonical_event_id:d.canonical_event_id,status:d.status,team_score:d.team_score,opponent_score:d.opponent_score,result:d.result};
 const filtered=!rowIsOfficialSeasonContest(c);
 const logical=candidates.find(r=>{const tc=truthCandidate(r);return resultEvidenceMatchesScheduleRow(tc,c,{reportingSchoolId:d.school_id})||scheduleRowsLikelyDuplicate(tc,c,{reportingSchoolId:d.school_id});})||null;
 const logicalSame=Boolean(logical)&&String(logical.status||"").toUpperCase()==="FINAL"&&Number(logical.team_score)===Number(d.team_score)&&Number(logical.opponent_score)===Number(d.opponent_score)&&evaluateFinalResultTruth(truthCandidate(logical)).state==="VERIFIED";
 const pre=Boolean(dateKeyInZone(d.scheduled_at||"","America/Chicago")<"2026-08-24");
 const summary=teamSummary.get(String(expected.team_id));
 const stale=Boolean(summary)&&(Date.parse(d.updated_at||d.last_checked_at||"")>Date.parse(summary.refreshed_at||"")||Date.parse(d.last_successful_fetch_at||"")>Date.parse(summary.refreshed_at||""));
 let klass="other";
 if(suppressed)klass="suppressed";else if(canonicalIncomplete)klass="canonical_incomplete_overrides_raw_final";else if(filtered)klass=pre?"pre_official_filter":"other_official_filter";else if(logicalSame)klass="logical_duplicate_same_final";else if(logical)klass="logical_duplicate_conflict";else if(truthRow)klass="truth_present_wrong_status_or_score";else if(stale)klass="stale_truth";
 obsCounts[klass]++;missing.push({event_key:expected.source_event_key,class:klass});
}
const byEvent=new Map();for(const m of missing){const k=String(m.event_key||"");if(!byEvent.has(k))byEvent.set(k,[]);byEvent.get(k).push(m);}
const priority=classes;
for(const items of byEvent.values()){let chosen="other";for(const p of priority){if(items.some(x=>x.class===p)){chosen=p;break;}}eventCounts[chosen]++;}
console.log(JSON.stringify({missing_events:byEvent.size,missing_observations:missing.length,eventCounts,obsCounts}));
NODE

ALIAS="$(node - "$TMPDIR/out.json" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const names=["suppressed","canonical_incomplete_overrides_raw_final","pre_official_filter","other_official_filter","logical_duplicate_same_final","logical_duplicate_conflict","truth_present_wrong_status_or_score","stale_truth","other"];
const fields=[[p.missing_events,10],[p.missing_observations,11],...names.map(n=>[p.eventCounts[n],6]),...names.map(n=>[p.obsCounts[n],6])];
let packed=0n;for(const [raw,bits] of fields){const v=BigInt(Math.max(0,Number(raw)||0));if(v>((1n<<BigInt(bits))-1n))throw new Error("overflow "+raw);packed=(packed<<BigInt(bits))|v;}
const alias="l"+packed.toString(36);if(alias.length>35)throw new Error("alias too long "+alias);console.log(alias);
NODE
)"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "WVB_LOSS_CLASSES_ALIAS=$ALIAS"
