import { buildScheduledAt, cleanText, parseMonthDay, parseResult, stableKeys } from "./parser-core.js";

function calendarYearForDate(dateText, source) {
  const startYear=Number(source.season);
  if (!Number.isInteger(startYear)) return source.season;
  if (String(source.sport||"").toLowerCase()!=="basketball") return String(startYear);
  const parsed=parseMonthDay(dateText,String(startYear));
  if (!parsed) return String(startYear);
  return String(parsed.month<=7?startYear+1:startYear);
}

function firstIndex(cells,predicate) {
  for (let i=0;i<cells.length;i++) if (predicate(cells[i],i)) return i;
  return -1;
}

function parseRankOneScore(value) {
  const text=cleanText(value);
  const standard=parseResult(text);
  if (standard.status==="FINAL") return standard;
  // Some public Rank One schedule themes render the Score column as a bare
  // school-score/opponent-score pair without a W/L prefix.
  const match=text.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!match) return standard;
  const teamScore=Number(match[1]);
  const opponentScore=Number(match[2]);
  return {
    status:"FINAL",
    teamScore,
    opponentScore,
    result:teamScore===opponentScore?"T":teamScore>opponentScore?"W":"L"
  };
}

export function normalizeRankOneRows(rows,source) {
  const events=[];
  for (const raw of rows||[]) {
    const cells=(raw.cells||[]).map(cleanText);
    const full=cleanText(raw.full || cells.filter(Boolean).join(" | "));
    if (!full) continue;

    const dateIndex=firstIndex(cells,value=>/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b/i.test(value));
    if (dateIndex<0) continue;
    const dateText=cells[dateIndex];
    const timeIndex=firstIndex(cells,(value,index)=>index>=dateIndex && /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i.test(value));
    const timeText=timeIndex>=0?cells[timeIndex]:"";
    const calendarYear=calendarYearForDate(dateText,source);
    const schedule=buildScheduledAt(`${dateText} ${timeText}`,calendarYear,source.timezone||"America/Chicago");
    if (!schedule) continue;

    let relationIndex=firstIndex(cells,value=>/^(?:@|AT|VS\.?|HOME|AWAY)$/i.test(value));
    let relation=relationIndex>=0?cells[relationIndex]:"";
    let opponent="";
    if (relationIndex>=0) {
      opponent=cleanText(cells.slice(relationIndex+1).find(value=>value && !/^[-–]$/.test(value))||"");
    }
    if (!opponent) {
      const combinedIndex=firstIndex(cells,value=>/^(?:@|AT|VS\.?)\s+\S/i.test(value));
      if (combinedIndex>=0) {
        const combined=cells[combinedIndex];
        const match=combined.match(/^(@|AT|VS\.?)\s+(.+)$/i);
        relation=match?.[1]||"";
        opponent=cleanText(match?.[2]||"");
        relationIndex=combinedIndex;
      }
    }
    // Modern Rank One public schedule tables use Date, Time, relation,
    // Opponent, Venue, Score, Special Notes. Fall back to that published shape.
    if (!opponent && cells[3] && !/^(?:opponent|venue|score)$/i.test(cells[3])) {
      opponent=cells[3];
      relation=cells[2]||relation;
      relationIndex=2;
    }
    if (!opponent) continue;
    opponent=cleanText(opponent.replace(/^(?:@|AT|VS\.?)\s+/i,""));
    if (!opponent || /^(?:opponent|tbd)$/i.test(opponent)) continue;

    const homeAway=/^(?:@|AT|AWAY)$/i.test(relation)?"away":/^(?:VS\.?|HOME)$/i.test(relation)?"home":"unknown";
    const scoreIndex=firstIndex(cells,value=>/\b[WLT]\b[^0-9]*\d+\s*[-–]\s*\d+/i.test(value) || /^\d+\s*[-–]\s*\d+$/.test(value));
    const result=scoreIndex>=0?parseRankOneScore(cells[scoreIndex]):{status:"SCHEDULED",teamScore:null,opponentScore:null,result:null};

    let venue="";
    if (cells[4] && 4!==scoreIndex && !/^(?:venue|score|special notes?)$/i.test(cells[4])) venue=cells[4];
    if (!venue && relationIndex>=0) {
      venue=cleanText(cells.slice(relationIndex+2).find((value,index)=>{
        const absolute=relationIndex+2+index;
        return value && absolute!==scoreIndex && !/^\d+\s*[-–]\s*\d+$/.test(value);
      })||"");
    }
    if (!venue && homeAway==="home") venue=cleanText(source.home_venue);

    const nonCount=/\b(?:scrimmage|jamboree|exhibition|benefit game)\b/i.test(full);
    events.push({
      nativeId:raw.nativeId||"",
      opponent,
      scheduledAt:schedule.scheduledAt,
      scheduledTimeKnown:schedule.timeKnown,
      venue,
      locationText:venue,
      latitude:homeAway==="home"?source.home_latitude:null,
      longitude:homeAway==="home"?source.home_longitude:null,
      homeAway,
      conferenceGame:0,
      countsForRecord:nonCount?0:1,
      ...result,
      notes:nonCount?(full.match(/\b(?:Scrimmage|Jamboree|Exhibition|Benefit Game)\b/i)?.[0]||""):""
    });
  }
  return stableKeys(events);
}
