import { runMaxPrepsVolleyballResultFallback } from "./maxpreps-volleyball-result-collector.js";

const TIME_ZONE="America/Chicago";
export const COMPLETED_DAY_LOOKBACK=3;

function localDateAt(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dateOffset(localDate,days){
  const [year,month,day]=String(localDate).split("-").map(Number);
  return localDateAt(new Date(Date.UTC(year,month-1,day+days,18,0,0)));
}

// The existing morning fallback already scans yesterday. This permanent M7 helper
// supplies only the older completed dates so the combined normal cadence covers a
// three-day completed-game window without duplicate page fetches.
export function datesForVolleyballHistoricalCatchup(plan,when=new Date(),lookbackDays=COMPLETED_DAY_LOOKBACK){
  if(plan?.kind!=="morning-results") return [];
  const today=localDateAt(when);
  const depth=Math.max(1,Math.min(7,Number(lookbackDays)||COMPLETED_DAY_LOOKBACK));
  const dates=[];
  for(let offset=-2;offset>=-depth;offset--) dates.push(dateOffset(today,offset));
  return dates.filter(Boolean);
}

// Intentionally not wired into the production scheduler until an M7 production
// write batch is explicitly approved. Once activated, this delegates to the same
// authority-preserving MaxPreps secondary collector used by normal live cadence.
export async function runVolleyballHistoricalCatchup(env,{plan,now=new Date(),fetchFn=fetch,targetTeamIds=null}={}){
  const dates=datesForVolleyballHistoricalCatchup(plan,now);
  if(!dates.length) return {status:"SKIPPED",dates:[],writes:0};
  return runMaxPrepsVolleyballResultFallback(env,{dates,fetchFn,now,targetTeamIds});
}

export { localDateAt, dateOffset };
