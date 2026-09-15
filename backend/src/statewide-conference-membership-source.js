import { parsePublishedStandings } from "./published-standings.js";

const MAXPREPS_ORIGIN="https://www.maxpreps.com";
const FETCH_BATCH_SIZE=4;
const REQUEST_HEADERS={
  "user-agent":"LocalBleachersAR-conference-membership/1.0 (+https://github.com/jamesmethvin74/game-nearby)",
  accept:"text/html,application/xhtml+xml"
};

function source({key,sport,gender,directoryPath,conferencePath}) {
  return Object.freeze({
    key,sport,gender,directoryPath,conferencePath,
    directoryUrl:`${MAXPREPS_ORIGIN}${directoryPath}`,
    authorityProvider:"maxpreps-aaa-partner",
    season:"2026"
  });
}

export const STATEWIDE_MEMBERSHIP_SOURCES=Object.freeze([
  source({key:"football-boys",sport:"football",gender:"boys",directoryPath:"/ar/football/",conferencePath:"/ar/football/26-27/conference/"}),
  source({key:"volleyball-girls",sport:"volleyball",gender:"girls",directoryPath:"/ar/volleyball/",conferencePath:"/ar/volleyball/26-27/conference/"}),
  source({key:"basketball-boys",sport:"basketball",gender:"boys",directoryPath:"/ar/basketball/",conferencePath:"/ar/basketball/26-27/conference/"}),
  source({key:"basketball-girls",sport:"basketball",gender:"girls",directoryPath:"/ar/basketball/girls/",conferencePath:"/ar/basketball/girls/26-27/conference/"}),
  source({key:"soccer-boys",sport:"soccer",gender:"boys",directoryPath:"/ar/soccer/",conferencePath:"/ar/soccer/spring/26-27/conference/"}),
  source({key:"soccer-girls",sport:"soccer",gender:"girls",directoryPath:"/ar/soccer/girls/",conferencePath:"/ar/soccer/girls/spring/26-27/conference/"})
]);

function cleanText(value="") {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&#39;/g,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g," ")
    .trim();
}

function conferenceName(value,slug) {
  const text=cleanText(value)
    .replace(/\b(?:Conference|Standings|Football|Volleyball|Basketball|Soccer)\b/gi," ")
    .replace(/\s+/g," ").trim();
  if(text) return text;
  return String(slug||"").split("-").map(part=>/^\d+a$/i.test(part)?part.toUpperCase():part.charAt(0).toUpperCase()+part.slice(1)).join(" ");
}

export function parseCurrentConferenceLinks(html,sourceConfig) {
  const prefix=String(sourceConfig?.conferencePath||"").toLowerCase();
  if(!prefix) return [];
  const rows=[];
  const pattern=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while((match=pattern.exec(String(html||"")))) {
    let url;
    try { url=new URL(match[1],MAXPREPS_ORIGIN); } catch { continue; }
    const path=url.pathname.toLowerCase();
    if(!path.startsWith(prefix)) continue;
    const rest=path.slice(prefix.length).replace(/^\/+|\/+$/g,"");
    if(!rest || rest.includes("/")) continue;
    const id=decodeURIComponent(rest);
    rows.push({
      id,
      name:conferenceName(match[2],id),
      source_url:url.toString(),
      sport:sourceConfig.sport,
      gender:sourceConfig.gender,
      source_key:sourceConfig.key
    });
  }
  const byId=new Map();
  for(const row of rows) if(!byId.has(row.id)) byId.set(row.id,row);
  return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
}

async function fetchText(url,fetchFn) {
  const response=await fetchFn(url,{headers:REQUEST_HEADERS});
  if(!response.ok) throw new Error(`membership source HTTP ${response.status}: ${url}`);
  return {html:await response.text(),finalUrl:response.url||url};
}

export async function fetchCurrentConferenceRosters(sourceConfig,{fetchFn=fetch}={}) {
  const {html}=await fetchText(sourceConfig.directoryUrl,fetchFn);
  const conferences=parseCurrentConferenceLinks(html,sourceConfig);
  const rosters=[];
  const failures=[];
  for(let start=0;start<conferences.length;start+=FETCH_BATCH_SIZE) {
    const batch=conferences.slice(start,start+FETCH_BATCH_SIZE);
    const resolved=await Promise.all(batch.map(async conference=>{
      try {
        const target=conference.source_url || `${MAXPREPS_ORIGIN}${sourceConfig.conferencePath}${encodeURIComponent(conference.id)}/`;
        const page=await fetchText(target,fetchFn);
        const parsed=parsePublishedStandings(page.html,{
          sport:sourceConfig.sport,
          conferenceId:conference.id,
          conferenceName:conference.name,
          sourceUrl:page.finalUrl
        });
        if(!parsed.standings.length) throw new Error("empty conference roster");
        return {conference:{...conference,source_url:page.finalUrl},schools:parsed.standings.map(row=>row.school_name)};
      } catch(error) {
        return {conference,error:String(error?.message||error)};
      }
    }));
    for(const result of resolved) {
      if(result.schools) rosters.push(result);
      else failures.push({conference_id:result.conference.id,error:result.error});
    }
  }
  return {
    source:sourceConfig,
    discovered_conferences:conferences.length,
    fetched_conferences:rosters.length,
    conferences,
    rosters,
    failures
  };
}

export async function fetchAllStatewideConferenceRosters({fetchFn=fetch,sources=STATEWIDE_MEMBERSHIP_SOURCES}={}) {
  const results=[];
  for(const sourceConfig of sources) results.push(await fetchCurrentConferenceRosters(sourceConfig,{fetchFn}));
  return results;
}

export { FETCH_BATCH_SIZE };
