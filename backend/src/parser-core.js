export const MONTHS = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,dec:12,december:12
};

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

export function slug(value) {
  return cleanText(value).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}

export function parseResult(text) {
  const value = cleanText(text);
  if (!value || /^-\s*-?$/.test(value)) return {status:"SCHEDULED",teamScore:null,opponentScore:null,result:null};
  if (/cancel(?:ed|led)/i.test(value)) return {status:"CANCELED",teamScore:null,opponentScore:null,result:null};
  if (/postpon/i.test(value)) return {status:"POSTPONED",teamScore:null,opponentScore:null,result:null};
  const match = value.match(/\b([WLT])\s*,?\s*(\d+)\s*[-–]\s*(\d+)/i) || value.match(/\b([WLT])\b[^0-9]*(\d+)\s*[-–]\s*(\d+)/i);
  if (match) return {status:"FINAL",teamScore:Number(match[2]),opponentScore:Number(match[3]),result:match[1].toUpperCase()};
  const score = value.match(/\b(\d+)\s*[-–]\s*(\d+)\b/);
  if (score && /final/i.test(value)) {
    const teamScore=Number(score[1]), opponentScore=Number(score[2]);
    return {status:"FINAL",teamScore,opponentScore,result:teamScore===opponentScore?"T":teamScore>opponentScore?"W":"L"};
  }
  return {status:"SCHEDULED",teamScore:null,opponentScore:null,result:null};
}

export function parseMonthDay(text, season) {
  const value = cleanText(text).replace(/\./g, "");
  const match = value.match(/\b(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/i);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  return {year:Number(season),month,day:Number(match[2])};
}

export function parseClock(text) {
  const value = cleanText(text).replace(/\./g, "");
  const match = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!match) return {hour:12,minute:0,known:false};
  let hour=Number(match[1]);
  const minute=Number(match[2] || 0);
  const ap=match[3].toUpperCase();
  if (ap==="PM" && hour!==12) hour+=12;
  if (ap==="AM" && hour===12) hour=0;
  return {hour,minute,known:true};
}

function partsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));
}

export function zonedIso({year,month,day,hour,minute}, timeZone) {
  let guess=Date.UTC(year,month-1,day,hour,minute,0);
  for (let i=0;i<2;i++) {
    const p=partsInZone(new Date(guess),timeZone);
    const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second||0);
    guess-=represented-Date.UTC(year,month-1,day,hour,minute,0);
  }
  return new Date(guess).toISOString();
}

export function buildScheduledAt(dateText, season, timeZone) {
  const date=parseMonthDay(dateText,season);
  if (!date) return null;
  const clock=parseClock(dateText);
  return {scheduledAt:zonedIso({...date,...clock},timeZone),timeKnown:clock.known};
}

export function stableKeys(events) {
  const counts=new Map();
  return events.map(event=>{
    if (event.nativeId) return {...event,sourceEventKey:`native:${slug(event.nativeId)}`};
    const base=`${slug(event.opponent)}|${event.homeAway}`;
    const n=(counts.get(base)||0)+1;
    counts.set(base,n);
    return {...event,sourceEventKey:`${base}|${n}`};
  });
}

export function normalizeSidearmRows(rows, source) {
  const events=[];
  for (const raw of rows) {
    const dateText=cleanText(raw.date || raw.full);
    const schedule=buildScheduledAt(dateText,source.season,source.timezone);
    if (!schedule) continue;
    let opponent=cleanText(raw.opponentName || raw.opponentText);
    opponent=opponent.replace(/^(vs\.?|at)\s+/i,"").replace(/^#\d+\s*/,"").trim();
    if (!opponent || /^(history|live stats|tickets?)$/i.test(opponent)) continue;
    const relation=cleanText(`${raw.opponentText} ${raw.full}`);
    let homeAway="unknown";
    if (new RegExp(`\\bat\\s+(?:#\\d+\\s+)?${escapeRegExp(opponent)}`,"i").test(relation) || /^at\b/i.test(cleanText(raw.opponentText))) homeAway="away";
    else if (new RegExp(`\\bvs\\.?\\s+(?:#\\d+\\s+)?${escapeRegExp(opponent)}`,"i").test(relation) || /^vs\b/i.test(cleanText(raw.opponentText))) homeAway="home";
    const parsed=parseResult(raw.result);
    const full=cleanText(raw.full);
    const nonCount=/\b(exhibition|scrimmage|meet the cats|benefit game)\b/i.test(full);
    const venue=cleanText(raw.location) || (homeAway==="home"?source.home_venue:"");
    events.push({
      nativeId:raw.nativeId || "", opponent, scheduledAt:schedule.scheduledAt, scheduledTimeKnown:schedule.timeKnown,
      venue, locationText:venue, latitude:homeAway==="home"?source.home_latitude:null, longitude:homeAway==="home"?source.home_longitude:null,
      homeAway, conferenceGame:cleanText(raw.conference)?1:0, countsForRecord:nonCount?0:1,
      ...parsed, notes:nonCount?full.match(/\b(Exhibition|Scrimmage|Meet the Cats|Benefit Game)\b/i)?.[0]||"":""
    });
  }
  return stableKeys(events);
}

function mascotCalendarYear(text, source) {
  const season=Number(source.season);
  if (!Number.isInteger(season)) return source.season;
  if (String(source.sport||"").toLowerCase()!=="basketball") return String(season);
  const parsed=parseMonthDay(text,String(season));
  if (!parsed) return String(season);
  return String(parsed.month<=7?season+1:season);
}

export function normalizeMascotRows(rows, source) {
  const events=[];
  for (const raw of rows) {
    const cells=(raw.cells||[]).map(cleanText);
    const full=cleanText(cells.filter(Boolean).join(" | ") || raw.full);
    const schedule=buildScheduledAt(full,mascotCalendarYear(full,source),source.timezone);
    if (!schedule) continue;

    const relation=full.match(/\b(VS|AT)\s+(.+)/i);
    let homeAway="unknown";
    let opponent="";
    let venue="";

    if (relation) {
      homeAway=relation[1].toUpperCase()==="VS"?"home":"away";
      let tail=relation[2];
      const homeVenue=cleanText(source.home_venue);
      const siteCell=cleanText(cells[2]);
      const siteVenue=cleanText(siteCell.match(/^(.+?(?:Stadium|Field|Arena|Gymnasium|Gym|Center|Complex))\b/i)?.[1]);
      for (const candidate of [homeVenue,siteCell,siteVenue].filter(Boolean)) {
        const venueIndex=tail.toLowerCase().indexOf(candidate.toLowerCase());
        if (venueIndex>=0) {
          venue=siteVenue || (candidate===siteCell?siteCell:candidate);
          tail=tail.slice(0,venueIndex);
          break;
        }
      }
      if (!venue) {
        const venueMatch=tail.match(/\s+((?:[A-Za-z0-9.&'()-]+\s+){0,3}[A-Za-z0-9.&'()-]+\s+(?:Stadium|Field|Arena|Gymnasium|Gym|Center|Complex))\b/i);
        if (venueMatch) {
          venue=cleanText(venueMatch[1]);
          tail=tail.slice(0,venueMatch.index);
        }
      }
      opponent=cleanText(tail.replace(/\s+-\s+-.*$/,"").replace(/\|.*$/, ""));
    } else {
      // Newer Mascot Media tables split date/location, opponent and result into
      // separate cells and use "@" instead of the literal "AT" token.
      const dateLocation=cleanText(cells[0]);
      opponent=cleanText(cells[1]);
      if (!opponent || /^(opponent|results?)$/i.test(opponent)) continue;
      homeAway=/(?:^|\s)@\s+/i.test(dateLocation)?"away":"home";
      if (homeAway==="home") venue=cleanText(source.home_venue);
      else {
        const awaySite=dateLocation.match(/@\s+(.+?)(?:\s+[A-Za-z .'-]+,\s*[A-Z]{2}\b|\s+[WLT]\s*\d+\s*[-–]\s*\d+|$)/i);
        venue=cleanText(awaySite?.[1]);
      }
    }

    if (!opponent) continue;
    if (!venue && homeAway==="home") venue=source.home_venue || "";
    const resultText=[...cells].reverse().find(Boolean) || full;
    const result=parseResult(resultText);
    const nonCount=/\b(meet the cats|benefit game|scrimmage|exhibition)\b/i.test(full);
    events.push({
      nativeId:raw.nativeId||"", opponent, scheduledAt:schedule.scheduledAt, scheduledTimeKnown:schedule.timeKnown,
      venue, locationText:venue, latitude:homeAway==="home"?source.home_latitude:null, longitude:homeAway==="home"?source.home_longitude:null,
      homeAway, conferenceGame:0, countsForRecord:nonCount?0:1, ...result,
      notes:nonCount?full.match(/\b(Meet the Cats|Benefit Game|Scrimmage|Exhibition)\b/i)?.[0]||"":""
    });
  }
  return stableKeys(events);
}

function escapeRegExp(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
