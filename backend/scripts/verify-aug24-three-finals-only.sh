#!/usr/bin/env bash
set -euo pipefail
API="https://localbleachersar-sports-api.james-methvin74.workers.dev"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
curl -fsS --max-time 60 -H 'cache-control: no-store' \
  "$API/api/v1/scores?since=2026-08-24T05%3A00%3A00.000Z&until=2026-08-25T05%3A00%3A00.000Z&sport=volleyball&proof=aug24-verify-$(date +%s)" \
  -o "$OUT"
node - "$OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const games=Array.isArray(p.games)?p.games:[];
const norm=v=>String(v||'').toLowerCase().replace(/\b(high school|high|school|hs)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const expected=[
  {local:'Marion High School',opp:'Collierville',localScore:3,oppScore:1},
  {local:'Columbia Christian School',opp:'Word of God Academy',localScore:3,oppScore:1},
  {local:'Magnolia High School',opp:'Pleasant Grove',localScore:1,oppScore:3}
];
let matched=0;
for(const e of expected){
  const localKey=norm(e.local),oppKey=norm(e.opp);
  const row=games.find(g=>{const h=norm(g.home_school_name),a=norm(g.away_school_name);return (h===localKey&&a===oppKey)||(h===oppKey&&a===localKey);});
  if(!row || row.status!=='FINAL') continue;
  const localIsHome=norm(row.home_school_name)===localKey;
  const localScore=Number(localIsHome?row.home_score:row.away_score);
  const oppScore=Number(localIsHome?row.away_score:row.home_score);
  if(localScore===e.localScore&&oppScore===e.oppScore) matched++;
}
console.log(`AUG24_FINALS_MATCHED=${matched}`);
if(matched!==3) throw new Error(`Expected all 3 approved finals; matched ${matched}`);
console.log('AUG24_THREE_FINALS_VERIFIED');
NODE
