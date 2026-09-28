#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
TMPDIR="$(mktemp -d)"; trap 'rm -rf "$TMPDIR"' EXIT
WVB_PROVIDER="dragonfly:ArkAA:2026:WVB_Varsity"
WBB_PROVIDER="dragonfly:ArkAA:2026:WBB_Varsity"
wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$WVB_PROVIDER' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wvbm.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wvbs.json"
wrangler d1 execute "$DB" --remote --command="SELECT g.id,g.team_id,g.source_event_key,g.canonical_event_id,g.status,g.team_score,g.opponent_score,g.counts_for_record FROM games g JOIN teams t ON t.id=g.team_id JOIN sources src ON src.id=g.source_id WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL AND COALESCE(g.counts_for_record,1)<>0" --json > "$TMPDIR/wvbd1.json"
wrangler d1 execute "$DB" --remote --command="SELECT truth_id,team_id,game_id,canonical_event_id,status,team_score,opponent_score,counts_for_record FROM ONE_TRUTH_TB WHERE row_type='GAME' AND sport='volleyball' AND gender='girls' AND season='2026' AND status='FINAL' AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND COALESCE(counts_for_record,1)<>0" --json > "$TMPDIR/wvbt.json"
wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$WBB_PROVIDER' AND t.sport='basketball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wbbm.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='basketball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/wbbs.json"
node --input-type=module - "$TMPDIR" > "$TMPDIR/out.json" <<'NODE'
import fs from "node:fs";
import { fetchDragonFlyPagedPayload } from "./src/dragonfly-feed.js";
import { buildCertifiedStatewideRows } from "./src/dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./src/statewide-sport-config.js";
import { normalizeSchoolAlias } from "./src/schedule-authority-core.js";
const dir=process.argv[2];
const rows=f=>{const p=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));return (Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]);};
const clean=v=>String(v??"").replace(/\s+/g," ").trim(),score=v=>{if(v==null||v==="")return null;const n=Number(String(v).replace(/[^0-9.-]/g,""));return Number.isFinite(n)?n:null;};
const scored=g=>String(g?.status||"").toUpperCase()==="FINAL"&&score(g?.team_score)!=null&&score(g?.opponent_score)!=null&&Number(g?.counts_for_record??1)!==0;
async function sport(code,mfile,sfile){
 const cfg=statewideSportConfig(code),m=rows(mfile),s=rows(sfile),f=await fetchDragonFlyPagedPayload(cfg.feedUrl,{headers:{"user-agent":"LocalBleachersAR-identity-proof/1.0","accept":"application/json"}});
 return {cfg,m,s,payload:f.payload,built:buildCertifiedStatewideRows(f.payload,m,cfg,{schoolMappings:s,checkedAt:new Date().toISOString()})};
}
const wvb=await sport("WVB","wvbm.json","wvbs.json"), d1=rows("wvbd1.json"), truth=rows("wvbt.json");
const direct=new Map(wvb.m.map(x=>[clean(x.external_team_id),x])), unique=new Map(),amb=new Set();
for(const x of wvb.s){const k=clean(x.external_school_id).toUpperCase();if(!k||amb.has(k))continue;if(unique.has(k)&&unique.get(k).team_id!==x.team_id){unique.delete(k);amb.add(k);}else unique.set(k,x);}
const fall=[];
for(const e of (wvb.payload.schedule||[])){const at=clean(e?.date||e?.startDateTime||e?.scheduledAt);if(at.slice(0,10)<"2026-08-24")continue;const ps=Array.isArray(e?.participants)?e.participants:[];for(let i=0;i<ps.length;i++){const p=ps[i],o=ps.find((_,j)=>j!==i),a=score(p?.result?.score),bb=score(p?.result?.opponentScore)??score(o?.result?.score);if(a==null||bb==null)continue;const pt=clean(p?.team?.teamId);if(pt&&direct.has(pt))continue;const org=clean(p?.orgShortCode).toUpperCase(),m=unique.get(org);if(!m)continue;const eid=clean(e?.eventId||e?.id),key=eid+"|"+m.team_id;if(fall.some(x=>x.key===key))continue;const safe=eid.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");const ng=wvb.built.games.find(g=>g.team_id===m.team_id&&String(g.source_event_key||"")===`native:${safe}`);const dr=ng?d1.find(r=>r.id===ng.id):null;const tr=ng?truth.find(r=>r.game_id===ng.id||(dr?.canonical_event_id&&r.team_id===m.team_id&&r.canonical_event_id===dr.canonical_event_id)):null;fall.push({key,event_id:eid,team_id:m.team_id,school_id:m.school_id,school_name:m.school_name,org_short_code:org,provider_team_id:pt||null,opponent:clean(o?.name),team_score:a,opponent_score:bb,d1:Boolean(dr),truth:Boolean(tr)});}}
const wbb=await sport("WBB","wbbm.json","wbbs.json"), scheduled=new Set(wbb.built.games.map(g=>g.team_id));
const missing=wbb.m.filter(m=>!scheduled.has(m.team_id));
const rawPs=(wbb.payload.schedule||[]).flatMap(e=>Array.isArray(e?.participants)?e.participants:[]);
for(const m of missing){const orgs=new Set(wbb.s.filter(s=>s.team_id===m.team_id).map(s=>clean(s.external_school_id).toUpperCase()));const n=normalizeSchoolAlias(m.school_name);const orgHit=rawPs.some(p=>orgs.has(clean(p?.orgShortCode).toUpperCase()));const nameHit=rawPs.some(p=>normalizeSchoolAlias(p?.name)===n);m.reason=orgHit||nameHit?"alternate_identity_or_gap":"schedule_not_published";}
console.log(JSON.stringify({wvb:{normalized_scored_teams:new Set(wvb.built.games.filter(scored).map(g=>g.team_id)).size,d1_scored_teams:new Set(d1.map(x=>x.team_id)).size,truth_scored_teams:new Set(truth.map(x=>x.team_id)).size,fallback:fall},wbb:{mapped:wbb.m.length,scheduled_teams:scheduled.size,missing}}));
NODE
ALIAS="$(node - "$TMPDIR/out.json" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8")),f=p.wvb.fallback,m=p.wbb.missing;
if(f.length!==2||m.length!==1)throw new Error("cardinality fallback="+f.length+" missing="+m.length);
const fields=[[p.wvb.normalized_scored_teams,8],[p.wvb.d1_scored_teams,8],[p.wvb.truth_scored_teams,8],[f.length,3],[f.filter(x=>x.d1).length,3],[f.filter(x=>x.truth).length,3],[p.wbb.mapped,9],[p.wbb.scheduled_teams,9],[m.length,2],[m[0].reason==="schedule_not_published"?0:1,2]];
let packed=0n;for(const [raw,bits] of fields){const v=BigInt(Math.max(0,Number(raw)||0));packed=(packed<<BigInt(bits))|v;}
const code=x=>String(x.school_id||"").replace(/^df-/,"").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,6);
const alias="i"+packed.toString(36)+"-"+code(f[0])+"-"+code(f[1])+"-"+code(m[0]);if(alias.length>35)throw new Error("alias too long "+alias);console.log(alias);
NODE
)"
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "WVB_IDENTITY_ALIAS=$ALIAS"
