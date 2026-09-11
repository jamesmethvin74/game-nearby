import { maxPrepsScoresUrl, parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";

const START="2026-08-01";
const TIME_ZONE="America/Chicago";

function offset(localDate,days){
  const [y,m,d]=String(localDate).split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date(Date.UTC(y,m-1,d+days,18,0,0)));
}
function range(end){
  const rows=[];
  for(let day=START,guard=0;day<=end&&guard<60;day=offset(day,1),guard++) rows.push(day);
  return rows;
}
function urlDate(sourceUrl){
  try{
    const path=new URL(sourceUrl).pathname;
    const m=path.match(/\/(\d{1,2})-(\d{1,2})-(\d{4})\//);
    if(!m)return null;
    return `${m[3]}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  }catch{return null;}
}

export async function diagnoseMaxPrepsDateReplay({fetchFn=fetch,through="2026-08-20"}={}){
  if(!/^2026-\d{2}-\d{2}$/.test(String(through))) throw new Error("through must be a 2026 YYYY-MM-DD date");
  const dates=range(through);
  const observations=[];
  for(let i=0;i<dates.length;i+=5){
    const batch=await Promise.all(dates.slice(i,i+5).map(async requestedDate=>{
      const url=maxPrepsScoresUrl(requestedDate);
      const response=await fetchFn(url,{headers:{"user-agent":"LocalBleachersAR-m7-date-diagnostic/1.0","accept":"text/html,application/xhtml+xml"}});
      if(!response.ok) throw new Error(`MaxPreps HTTP ${response.status} for ${requestedDate}`);
      const rows=parseMaxPrepsVolleyballScores(await response.text(),{localDate:requestedDate,sourceUrl:response.url||url});
      return rows.map(row=>({requested_date:requestedDate,contest_id:String(row.contestId),url_date:urlDate(row.sourceUrl),source_url:row.sourceUrl,home:row.home.name,away:row.away.name,score:`${row.home.score}-${row.away.score}`}));
    }));
    observations.push(...batch.flat());
  }
  const byContest=new Map();
  for(const row of observations){
    if(!byContest.has(row.contest_id))byContest.set(row.contest_id,[]);
    byContest.get(row.contest_id).push(row);
  }
  const repeats=[...byContest.entries()]
    .filter(([,rows])=>rows.length>1)
    .map(([contest_id,rows])=>({contest_id,count:rows.length,requested_dates:[...new Set(rows.map(r=>r.requested_date))],url_dates:[...new Set(rows.map(r=>r.url_date).filter(Boolean))],sample:rows[0]}))
    .sort((a,b)=>b.count-a.count||a.contest_id.localeCompare(b.contest_id));
  const requestedVsUrlMismatch=observations.filter(row=>row.url_date&&row.url_date!==row.requested_date);
  return {
    through,
    dates:dates.length,
    parsed_observations:observations.length,
    unique_contests:byContest.size,
    repeated_contests:repeats.length,
    duplicate_observations:observations.length-byContest.size,
    requested_vs_url_date_mismatches:requestedVsUrlMismatch.length,
    repeats:repeats.slice(0,50),
    mismatches:requestedVsUrlMismatch.slice(0,50),
    invariants:{d1_statements:0,d1_rows_read:0,d1_rows_written:0}
  };
}
