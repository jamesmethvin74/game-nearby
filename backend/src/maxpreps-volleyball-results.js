import { normalizeSchoolAlias } from "./schedule-authority-core.js";

const MAXPREPS_SCORES_BASE="https://www.maxpreps.com/ar/volleyball/scores/";

function decodeNumericEntities(value="") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi,(_,hex)=>{
      const code=Number.parseInt(hex,16);
      return Number.isFinite(code)?String.fromCodePoint(code):_;
    })
    .replace(/&#(\d+);/g,(_,decimal)=>{
      const code=Number.parseInt(decimal,10);
      return Number.isFinite(code)?String.fromCodePoint(code):_;
    });
}

function cleanText(value="") {
  return decodeNumericEntities(String(value)
    .replace(/<span\b[^>]*class=["'][^"']*rank[^"']*["'][^>]*>[\s\S]*?<\/span>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&#39;/g,"'")
    .replace(/&quot;/gi,'"'))
    .replace(/\s+/g," ")
    .trim();
}

function attr(tag,name) {
  const match=String(tag).match(new RegExp(`${name}=["']([^"']*)["']`,"i"));
  return match?.[1]||"";
}

function scoreNumber(value) {
  const match=String(value||"").match(/<div\b[^>]*class=["'][^"']*score[^"']*["'][^>]*>\s*(-?\d+)\s*<\/div>/i);
  return match?Number(match[1]):null;
}

function teamName(value) {
  const match=String(value||"").match(/<div\b[^>]*class=["'][^"']*name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  return cleanText(match?.[1]||"");
}

function teamOptions(html) {
  const map=new Map();
  for(const match of String(html||"").matchAll(/<option\b[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi)) {
    const id=String(match[1]||"").trim();
    const name=cleanText(match[2]);
    if(id&&name&&name.toLowerCase()!=="select") map.set(id,name);
  }
  return map;
}

function contestSlices(html) {
  const body=String(html||"");
  const starts=[...body.matchAll(/<li\b[^>]*class=["']c["'][^>]*>/gi)];
  return starts.map((match,index)=>({
    tag:match[0],
    body:body.slice(match.index,index+1<starts.length?starts[index+1].index:body.length)
  }));
}

function parseCardTeams(body) {
  const teams=[];
  for(const match of String(body||"").matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const content=match[2]||"";
    const name=teamName(content);
    const score=scoreNumber(content);
    if(!name || score==null) continue;
    teams.push({name,score,winner:/\bwinner\b/i.test(match[1]||"")});
    if(teams.length===2) break;
  }
  return teams;
}

function scoreForSchool(cardTeams,schoolName) {
  const key=normalizeSchoolAlias(schoolName);
  const match=cardTeams.find(team=>normalizeSchoolAlias(team.name)===key);
  return match?.score??null;
}

function localAliasVariants(team={}) {
  const raw=[team.school_name,team.name,team.raw_school_name,team.location_matched_name]
    .map(value=>String(value||"").trim()).filter(Boolean);
  const aliases=new Set();
  for(const value of raw) {
    const base=normalizeSchoolAlias(value);
    if(base) aliases.add(base);
    const withoutGradeWords=value.replace(/\b(?:senior|sr\.?|junior|jr\.?)\b/gi," ");
    const simplified=normalizeSchoolAlias(withoutGradeWords);
    if(simplified) aliases.add(simplified);
  }
  return [...aliases];
}

export function maxPrepsScoresUrl(localDate) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(localDate||""))) throw new Error("MaxPreps score date must be YYYY-MM-DD");
  const [year,month,day]=localDate.split("-").map(Number);
  return `${MAXPREPS_SCORES_BASE}?date=${encodeURIComponent(`${month}/${day}/${year}`)}`;
}

export function parseMaxPrepsVolleyballScores(html,{localDate,sourceUrl=maxPrepsScoresUrl(localDate)}={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(localDate||""))) throw new Error("localDate is required");
  const options=teamOptions(html);
  const finals=[];
  for(const slice of contestSlices(html)) {
    const contestId=attr(slice.tag,"data-contest-id");
    const teamIds=attr(slice.tag,"data-teams").split(",").map(value=>value.trim()).filter(Boolean);
    if(!contestId || teamIds.length!==2) continue;
    if(!/<div\b[^>]*class=["'][^"']*details[^"']*["'][^>]*>\s*Final\s*<\/div>/i.test(slice.body)) continue;
    const cardTeams=parseCardTeams(slice.body);
    if(cardTeams.length!==2) continue;
    const homeName=options.get(teamIds[0])||"";
    const awayName=options.get(teamIds[1])||"";
    if(!homeName || !awayName) continue;
    const homeScore=scoreForSchool(cardTeams,homeName);
    const awayScore=scoreForSchool(cardTeams,awayName);
    if(homeScore==null || awayScore==null) continue;
    const hrefMatch=slice.body.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*c-c[^"']*["']/i);
    const eventUrl=hrefMatch?new URL(hrefMatch[1],"https://www.maxpreps.com").toString():sourceUrl;
    finals.push({
      contestId,
      localDate,
      sourceUrl:eventUrl,
      home:{maxprepsId:teamIds[0],name:homeName,score:homeScore},
      away:{maxprepsId:teamIds[1],name:awayName,score:awayScore}
    });
  }
  return finals;
}

export function matchLocalVolleyballTeams(finals,localTeams) {
  const byNameMaps=new Map();
  for(const team of localTeams||[]) {
    for(const key of localAliasVariants(team)) {
      if(!byNameMaps.has(key)) byNameMaps.set(key,new Map());
      byNameMaps.get(key).set(String(team.team_id||team.school_id),team);
    }
  }
  const byName=new Map([...byNameMaps].map(([key,map])=>[key,[...map.values()]]));
  const matched=[];
  const oneSided=[];
  const ambiguous=[];
  for(const final of finals||[]) {
    const homeCandidates=byName.get(normalizeSchoolAlias(final.home.name))||[];
    const awayCandidates=byName.get(normalizeSchoolAlias(final.away.name))||[];
    if(homeCandidates.length===1 && awayCandidates.length===1) {
      const homeTeam=homeCandidates[0],awayTeam=awayCandidates[0];
      if(homeTeam.school_id===awayTeam.school_id) continue;
      matched.push({...final,homeTeam,awayTeam});
      continue;
    }
    if(homeCandidates.length===1 && awayCandidates.length===0) {
      oneSided.push({...final,homeTeam:homeCandidates[0],awayTeam:null,unresolvedSide:"away"});
      continue;
    }
    if(homeCandidates.length===0 && awayCandidates.length===1) {
      oneSided.push({...final,homeTeam:null,awayTeam:awayCandidates[0],unresolvedSide:"home"});
      continue;
    }
    ambiguous.push({contestId:final.contestId,home:final.home.name,away:final.away.name,homeCandidates:homeCandidates.length,awayCandidates:awayCandidates.length});
  }
  return {matched,oneSided,ambiguous};
}

export { MAXPREPS_SCORES_BASE };
