const API="https://localbleachersar-sports-api.james-methvin74.workers.dev";
const url=`${API}/api/v1/scores?since=2026-08-24T05%3A00%3A00.000Z&until=2026-08-25T05%3A00%3A00.000Z&sport=volleyball&proof=aug24-v2-production-state`;
const response=await fetch(url,{headers:{accept:"application/json","cache-control":"no-store"}});
if(!response.ok) throw new Error(`scores HTTP ${response.status}`);
const payload=await response.json();
const games=Array.isArray(payload.games)?payload.games:[];
const norm=v=>String(v||"").toLowerCase().replace(/\b(high school|high|school|hs)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const expected=[
  {local:"Marion High School",opp:"Collierville",localScore:3,oppScore:1},
  {local:"Columbia Christian School",opp:"Word of God Academy",localScore:3,oppScore:1},
  {local:"Magnolia High School",opp:"Pleasant Grove",localScore:1,oppScore:3}
];
let matched=0;
for(const e of expected){
  const local=norm(e.local),opp=norm(e.opp);
  const row=games.find(g=>{
    const h=norm(g.home_school_name),a=norm(g.away_school_name);
    return (h===local&&a===opp)||(h===opp&&a===local);
  });
  if(!row) continue;
  const localHome=norm(row.home_school_name)===local;
  const ls=Number(localHome?row.home_score:row.away_score);
  const os=Number(localHome?row.away_score:row.home_score);
  if(row.status==="FINAL"&&ls===e.localScore&&os===e.oppScore) matched++;
}
console.log(`AUG24_V2_PRODUCTION_FINALS_MATCHED=${matched}`);
if(matched!==3) throw new Error(`Expected all 3 approved finals in production; matched ${matched}`);
console.log("AUG24_V2_PRODUCTION_STATE=ALL_THREE_PRESENT");
