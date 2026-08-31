import { cleanText, stableKeys, zonedIso } from "./parser-core.js";
import { normalizeSchoolAlias } from "./schedule-authority-core.js";

function firstValue(object, paths) {
  for (const path of paths) {
    let value=object;
    for (const key of path.split(".")) value=value?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function schoolName(value) {
  if (typeof value === "string") return cleanText(value);
  if (!value || typeof value !== "object") return "";
  return cleanText(firstValue(value,["name","schoolName","teamName","displayName","shortName","organization.name","school.name"]));
}

function hasDragonFlyParticipants(value) {
  return Array.isArray(value?.participants)
    && value.participants.length >= 2
    && value.participants.some(p=>schoolName(p));
}

function collectEventObjects(value, out=[], seen=new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectEventObjects(item,out,seen);
    return out;
  }
  const start=firstValue(value,["startDateTime","scheduledAt","startTime","dateTime","eventDateTime","start","date"]);
  const home=schoolName(firstValue(value,["homeTeam","homeSchool","home","home_team"]));
  const away=schoolName(firstValue(value,["awayTeam","awaySchool","away","visitorTeam","visitor","away_team"]));
  if (start && (hasDragonFlyParticipants(value) || (home && away))) out.push(value);
  for (const nested of Object.values(value)) if (nested && typeof nested === "object") collectEventObjects(nested,out,seen);
  return out;
}

function parseIsoish(value, source) {
  if (!value) return null;
  if (typeof value === "number") {
    const date=new Date(value > 1e12 ? value : value*1000);
    return Number.isNaN(date.getTime())?null:date.toISOString();
  }
  const text=cleanText(value);
  const parsed=Date.parse(text);
  if (Number.isFinite(parsed) && /[TZ]|[+-]\d\d:?\d\d$/.test(text)) return new Date(parsed).toISOString();
  const m=text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (!m) return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
  let hour=Number(m[4]||12), minute=Number(m[5]||0);
  const ap=(m[6]||"").toUpperCase();
  if (ap === "PM" && hour !== 12) hour+=12;
  if (ap === "AM" && hour === 12) hour=0;
  return zonedIso({year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour,minute},source.timezone||"America/Chicago");
}

function statusFrom(value) {
  const text=cleanText(value).toUpperCase();
  if (/CANCEL/.test(text)) return "CANCELED";
  if (/POSTPON/.test(text)) return "POSTPONED";
  if (/FINAL|COMPLETE|COMPLETED/.test(text)) return "FINAL";
  return "SCHEDULED";
}

function scoreNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n=Number(String(value).replace(/[^0-9.-]/g,""));
  return Number.isFinite(n)?n:null;
}

function eventMatchesSource(event,source) {
  const sports=Array.isArray(event?.associatedSports) ? event.associatedSports : [];
  const sportText=[
    firstValue(event,["sport.code","sportCode","sport.name","sportName","activity.name"]),
    ...sports.flatMap(s=>[s?.code,s?.name])
  ].map(cleanText).filter(Boolean).join(" ").toLowerCase();
  if (source.sport && sportText && !sportText.includes(String(source.sport).toLowerCase()) && !(String(source.sport).toLowerCase()==="volleyball" && /\bwvb\b|volleyball/.test(sportText))) return false;
  const levels=[firstValue(event,["level.name","level","teamLevel","competitionLevel"]),...sports.map(s=>s?.level),...(event?.participants||[]).map(p=>p?.team?.level)]
    .map(cleanText).filter(Boolean).join(" ").toLowerCase();
  if (levels && !/varsity/.test(levels)) return false;
  return true;
}

function resultFromScores(teamScore,opponentScore,explicitCode="") {
  const code=cleanText(explicitCode).toUpperCase();
  if (/^[WLT]$/.test(code)) return code;
  if (teamScore==null || opponentScore==null) return null;
  return Number(teamScore)===Number(opponentScore)?"T":Number(teamScore)>Number(opponentScore)?"W":"L";
}

function normalizeParticipantEvent(raw,source,sourceTimestamp) {
  const reporter=normalizeSchoolAlias(source.school_name);
  const participants=Array.isArray(raw.participants)?raw.participants:[];
  const reportingParticipant=participants.find(p=>normalizeSchoolAlias(schoolName(p))===reporter);
  if (!reportingParticipant) return null;
  const opponentParticipant=participants.find(p=>p!==reportingParticipant && schoolName(p));
  if (!opponentParticipant) return null;
  const scheduledAt=parseIsoish(firstValue(raw,["date","startDateTime","scheduledAt","startTime","dateTime","eventDateTime","start"]),source);
  if (!scheduledAt) return null;
  const explicitStatus=firstValue(raw,["status.name","status","gameStatus","state"]);
  const reportingResult=reportingParticipant.result || null;
  const hasResult=Boolean(reportingResult || (Array.isArray(raw.results)&&raw.results.length));
  let status=statusFrom(explicitStatus);
  if (status==="SCHEDULED" && hasResult) status="FINAL";
  const teamScore=scoreNumber(reportingResult?.score);
  const opponentScore=scoreNumber(reportingResult?.opponentScore);
  const result=status==="FINAL"?resultFromScores(teamScore,opponentScore,reportingResult?.code):null;
  const venue=cleanText(raw?.facility?.name || raw?.hostOrgName || "");
  const locationNotes=cleanText(raw?.locationNotes || "");
  const homeAway=reportingParticipant.isHome===true?"home":reportingParticipant.isHome===false?"away":"unknown";
  const timeKnown=!Boolean(firstValue(raw,["timeTba","timeTBD","isTimeTba","isTimeTBD"]));
  return {
    nativeId:cleanText(raw.eventId || raw.id || raw.gameId || raw.contestId || raw.uuid),
    opponent:schoolName(opponentParticipant),scheduledAt,scheduledTimeKnown:timeKnown,
    venue,locationText:locationNotes || venue,
    latitude:homeAway==="home"?source.home_latitude:null,longitude:homeAway==="home"?source.home_longitude:null,
    homeAway,conferenceGame:Number(Boolean(firstValue(raw,["conferenceGame","isConference","regionGame"]))),countsForRecord:raw.contestType==="exhibition"?0:1,
    status,teamScore,opponentScore,result,notes:locationNotes,
    sourceUpdatedAt:sourceTimestamp || null
  };
}

function normalizeLegacyHomeAwayEvent(raw,source,sourceTimestamp) {
  const reporter=normalizeSchoolAlias(source.school_name);
  const home=schoolName(firstValue(raw,["homeTeam","homeSchool","home","home_team"]));
  const away=schoolName(firstValue(raw,["awayTeam","awaySchool","away","visitorTeam","visitor","away_team"]));
  const homeKey=normalizeSchoolAlias(home), awayKey=normalizeSchoolAlias(away);
  let homeAway="unknown", opponent="";
  if (reporter && homeKey === reporter) { homeAway="home"; opponent=away; }
  else if (reporter && awayKey === reporter) { homeAway="away"; opponent=home; }
  else return null;
  const rawStart=firstValue(raw,["startDateTime","scheduledAt","startTime","dateTime","eventDateTime","start","date"]);
  const scheduledAt=parseIsoish(rawStart,source);
  if (!scheduledAt) return null;
  const timeText=cleanText(rawStart);
  const timeKnown=!/\bTBA\b|\bTBD\b/i.test(timeText) && /\d{1,2}:?\d{0,2}\s*(?:AM|PM)|T\d{2}:\d{2}/i.test(timeText);
  const status=statusFrom(firstValue(raw,["status.name","status","gameStatus","state"]));
  const homeScore=scoreNumber(firstValue(raw,["homeScore","score.home","home.score","home_team.score"]));
  const awayScore=scoreNumber(firstValue(raw,["awayScore","score.away","visitorScore","away.score","away_team.score"]));
  const teamScore=homeAway==="home"?homeScore:awayScore;
  const opponentScore=homeAway==="home"?awayScore:homeScore;
  const result=status==="FINAL"?resultFromScores(teamScore,opponentScore):null;
  const venue=cleanText(firstValue(raw,["venue.name","venue","location.name","location","site.name","facility.name"]));
  return {
    nativeId:cleanText(firstValue(raw,["id","eventId","gameId","contestId","uuid"])),opponent,scheduledAt,scheduledTimeKnown:timeKnown,
    venue,locationText:venue,latitude:homeAway==="home"?source.home_latitude:null,longitude:homeAway==="home"?source.home_longitude:null,
    homeAway,conferenceGame:Number(Boolean(firstValue(raw,["conferenceGame","isConference","regionGame"]))),countsForRecord:1,
    status,teamScore,opponentScore,result,notes:"",sourceUpdatedAt:sourceTimestamp || null
  };
}

export function normalizeDragonFlyPayload(payload,source) {
  const sourceTimestamp=cleanText(payload?.timestamp || payload?.updatedAt || payload?.lastUpdated || "") || null;
  const events=[];
  for (const raw of collectEventObjects(payload)) {
    if (!eventMatchesSource(raw,source)) continue;
    const normalized=hasDragonFlyParticipants(raw)
      ? normalizeParticipantEvent(raw,source,sourceTimestamp)
      : normalizeLegacyHomeAwayEvent(raw,source,sourceTimestamp);
    if (normalized) events.push(normalized);
  }
  return stableKeys(events);
}

function usefulLine(value) {
  const line=cleanText(value).replace(/^Image:?\s*/i,"");
  if (!line || /^(Tickets?|Watch|Image|\* \* \*)$/i.test(line)) return "";
  return line;
}

function parsePublicClock(line) {
  const m=cleanText(line).match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!m) return {hour:12,minute:0,known:false};
  let hour=Number(m[1]); const minute=Number(m[2]||0), ap=m[3].toUpperCase();
  if (ap==="PM"&&hour!==12) hour+=12;
  if (ap==="AM"&&hour===12) hour=0;
  return {hour,minute,known:true};
}

function seasonYearForMonth(season,month) {
  const start=Number(season);
  return month >= 7 ? start : start+1;
}

export function normalizeDragonFlyPublicText(text,source) {
  const rawLines=String(text||"").split(/\r?\n/).map(usefulLine).filter(Boolean);
  const reporter=normalizeSchoolAlias(source.school_name);
  const events=[];
  for (let i=0;i<rawLines.length;i++) {
    const dateMatch=rawLines[i].match(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\/(\d{1,2})$/i);
    if (!dateMatch) continue;
    const clockLine=rawLines[i+1]||"";
    if (source.sport && !clockLine.toLowerCase().includes(String(source.sport).toLowerCase())) continue;
    const before=rawLines.slice(Math.max(0,i-8),i).filter(line=>!/^Varsity\b/i.test(line) && !/^State\b/i.test(line) && !/^place/i.test(line));
    const teamCandidates=before.filter(line=>!/^\d/.test(line) && !/^(Today|Week|Month|Season)$/i.test(line)).slice(-2);
    if (teamCandidates.length<2) continue;
    const first=teamCandidates[0], second=teamCandidates[1];
    const firstHome=/^\(H\)\s*/i.test(first), secondHome=/^\(H\)\s*/i.test(second);
    const firstName=cleanText(first.replace(/^\(H\)\s*/i,""));
    const secondName=cleanText(second.replace(/^\(H\)\s*/i,""));
    const homeName=firstHome?firstName:secondHome?secondName:"";
    const awayName=firstHome?secondName:secondHome?firstName:"";
    if (!homeName || !awayName) continue;
    const homeKey=normalizeSchoolAlias(homeName), awayKey=normalizeSchoolAlias(awayName);
    let homeAway="unknown", opponent="";
    if (homeKey===reporter) { homeAway="home"; opponent=awayName; }
    else if (awayKey===reporter) { homeAway="away"; opponent=homeName; }
    else continue;
    const month=Number(dateMatch[1]), day=Number(dateMatch[2]), clock=parsePublicClock(clockLine);
    const year=seasonYearForMonth(source.season,month);
    const scheduledAt=zonedIso({year,month,day,hour:clock.hour,minute:clock.minute},source.timezone||"America/Chicago");
    const after=rawLines.slice(i+2,Math.min(rawLines.length,i+9));
    const venueLine=after.find(line=>/^place/i.test(line));
    const venue=cleanText((venueLine||"").replace(/^place/i,""));
    const scoreWindow=after.slice(0,6).join(" ");
    const nums=[...scoreWindow.matchAll(/\b(\d{1,3})\b/g)].map(m=>Number(m[1]));
    const final=/\bWIN\b|\bLOSS\b|\bFINAL\b/i.test(scoreWindow) && nums.length>=2;
    let teamScore=null,opponentScore=null,result=null;
    if (final) {
      const homeScore=nums[0],awayScore=nums[1];
      teamScore=homeAway==="home"?homeScore:awayScore;
      opponentScore=homeAway==="home"?awayScore:homeScore;
      result=resultFromScores(teamScore,opponentScore);
    }
    events.push({nativeId:"",opponent,scheduledAt,scheduledTimeKnown:clock.known,venue,locationText:venue,
      latitude:homeAway==="home"?source.home_latitude:null,longitude:homeAway==="home"?source.home_longitude:null,
      homeAway,conferenceGame:0,countsForRecord:1,status:final?"FINAL":"SCHEDULED",teamScore,opponentScore,result,notes:""});
  }
  return stableKeys(events);
}

export function extractPublicJsonFromHtml(html) {
  const candidates=[];
  const patterns=[
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try { candidates.push(JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,"&"))); } catch {}
    }
  }
  return candidates;
}

export function normalizeDragonFlyHtml(html,source,{visibleText=""}={}) {
  for (const payload of extractPublicJsonFromHtml(html)) {
    const parsed=normalizeDragonFlyPayload(payload,source);
    if (parsed.length) return parsed;
  }
  return normalizeDragonFlyPublicText(visibleText,source);
}
