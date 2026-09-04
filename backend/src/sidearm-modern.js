import { cleanText, parseClock, parseMonthDay, parseResult, stableKeys, zonedIso } from "./parser-core.js";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;|&#x27;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,"–")
    .replace(/&mdash;|&#8212;/gi,"—")
    .replace(/&#(\d+);/g,(_,code)=>String.fromCharCode(Number(code)));
}

function text(value) {
  return cleanText(decodeEntities(String(value || "")
    .replace(/<!--[\s\S]*?-->/g," ")
    .replace(/<span\b[^>]*class=["']sr-only["'][^>]*>[\s\S]*?<\/span>/gi," ")
    .replace(/<[^>]+>/g," ")));
}

function first(block, expression) {
  return text(block.match(expression)?.[1] || "");
}

function eventRows(html) {
  const rows=[];
  const re=/<tr\b[^>]*class=["'][^"']*\bschedule-table-item\b(?!__)[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi;
  let match;
  while((match=re.exec(String(html||"")))) rows.push(match[0]);
  return rows;
}

function scheduledAt(dateText,timeText,source) {
  const date=parseMonthDay(dateText,source.season);
  if(!date) return null;
  const clock=parseClock(timeText);
  let year=date.year;
  if(source.sport==="basketball" && date.month<=6) year+=1;
  return {
    scheduledAt:zonedIso({year,month:date.month,day:date.day,hour:clock.hour,minute:clock.minute},source.timezone||"America/Chicago"),
    timeKnown:clock.known
  };
}

export function normalizeModernSidearmHtml(html,source) {
  const events=[];
  for(const row of eventRows(html)) {
    const dateText=first(row,/<time\b[^>]*class=["'][^"']*\bschedule-event-date__day\b[^"']*["'][^>]*>([\s\S]*?)<\/time>/i);
    const opponentMatches=[...row.matchAll(/<strong\b[^>]*class=["'][^"']*\bschedule-event-item__opponent-name\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/gi)]
      .map(match=>text(match[1])).filter(Boolean);
    const opponent=opponentMatches[0] || "";
    if(!dateText || !opponent || /^(?:tba|tbd)$/i.test(opponent)) continue;

    const divider=first(row,/<strong\b[^>]*class=["'][^"']*\bschedule-event-item__divider\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i).toLowerCase();
    const location=first(row,/<span\b[^>]*class=["'][^"']*\bschedule-event-location\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const resultBlock=row.match(/<div\b[^>]*class=["'][^"']*\bschedule-event-item-result\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] || "";
    const resultText=text(resultBlock);
    const schedule=scheduledAt(dateText,resultText,source);
    if(!schedule) continue;

    let homeAway=divider.startsWith("at")?"away":divider.startsWith("vs")?"home":"unknown";
    if(/schedule-table-item--neutral|schedule-event-item--neutral/i.test(row)) homeAway="neutral";
    const parsed=parseResult(resultText);
    const promo=first(row,/<strong\b[^>]*class=["'][^"']*\bschedule-event-item__promo-title\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i);
    const nonCount=/\b(exhibition|scrimmage)\b/i.test(promo);
    const venue=location || (homeAway==="home"?cleanText(source.home_venue):"");
    const nativeId=first(row,/<div\b[^>]*class=["'][^"']*\bschedule-event-item__dashboard-link\b[^"']*["'][^>]*entity-id=["']([^"']+)["']/i) || `${dateText}|${opponent}|${homeAway}`;

    events.push({
      nativeId,
      opponent,
      scheduledAt:schedule.scheduledAt,
      scheduledTimeKnown:schedule.timeKnown,
      venue,
      locationText:venue,
      latitude:homeAway==="home"?source.home_latitude??null:null,
      longitude:homeAway==="home"?source.home_longitude??null:null,
      homeAway,
      conferenceGame:0,
      countsForRecord:nonCount?0:1,
      ...parsed,
      notes:nonCount?promo:""
    });
  }
  return stableKeys(events);
}
