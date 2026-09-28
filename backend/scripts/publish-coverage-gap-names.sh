#!/usr/bin/env bash
set -euo pipefail
DB="localbleachersar-sports"
WVB_PROVIDER="dragonfly:ArkAA:2026:WVB_Varsity"
TMPDIR="$(mktemp -d)"; trap 'rm -rf "$TMPDIR"' EXIT
wrangler d1 execute "$DB" --remote --command="SELECT tei.external_team_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM team_external_identities tei JOIN teams t ON t.id=tei.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE tei.provider='$WVB_PROVIDER' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/maps.json"
wrangler d1 execute "$DB" --remote --command="SELECT UPPER(sei.external_school_id) external_school_id,src.id source_id,src.source_url,t.id team_id,t.school_id,sch.name school_name,sch.latitude,sch.longitude FROM school_external_identities sei JOIN teams t ON t.school_id=sei.school_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide' WHERE sei.provider='dragonfly' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1" --json > "$TMPDIR/schools.json"
wrangler d1 execute "$DB" --remote --command="SELECT id school_id,name school_name FROM schools WHERE id='df-qx6b5u'" --json > "$TMPDIR/wbb.json"
node --input-type=module - "$TMPDIR" > "$TMPDIR/name.txt" <<'NODE'
import fs from "node:fs";
import { fetchDragonFlyPagedPayload } from "./src/dragonfly-feed.js";
import { buildCertifiedStatewideRows } from "./src/dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./src/statewide-sport-config.js";
const dir=process.argv[2];
const rows=f=>{const p=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));return (Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]);};
const maps=rows("maps.json"),schools=rows("schools.json"),cfg=statewideSportConfig("WVB");
const f=await fetchDragonFlyPagedPayload(cfg.feedUrl,{headers:{"user-agent":"LocalBleachersAR-gap-name/1.0","accept":"application/json"}});
const built=buildCertifiedStatewideRows(f.payload,maps,cfg,{schoolMappings:schools,checkedAt:new Date().toISOString()});
const scored=new Set(built.games.filter(g=>g.status==="FINAL"&&g.team_score!=null&&g.opponent_score!=null&&Number(g.counts_for_record??1)!==0).map(g=>String(g.team_id)));
const uniq=new Map();for(const m of maps)uniq.set(String(m.team_id),m);
const missing=[...uniq.values()].filter(m=>!scored.has(String(m.team_id))).sort((a,b)=>String(a.school_name).localeCompare(String(b.school_name)));
const wbb=rows("wbb.json")[0]||{};
if(missing.length!==2)throw new Error("expected two WVB no-score teams");
const slug=x=>String(x||"none").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,10)||"none";
console.log("n-"+slug(missing[0].school_name)+"-"+slug(missing[1].school_name)+"-"+slug(wbb.school_name));
NODE
ALIAS="$(cat "$TMPDIR/name.txt")"
[ "${#ALIAS}" -le 35 ] || { echo "alias too long: $ALIAS" >&2; exit 1; }
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
echo "COVERAGE_GAP_NAMES=$ALIAS"
