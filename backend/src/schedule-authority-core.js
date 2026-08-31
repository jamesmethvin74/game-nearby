export function cleanAuthorityText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeSchoolAlias(value) {
  return cleanAuthorityText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:high school|high|school|hs)\b/g, " ")
    .replace(/\barkansas\b|\bar\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dateKeyInZone(iso, timeZone="America/Chicago") {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year:"numeric", month:"2-digit", day:"2-digit"
  }).format(date);
}

function clockKeyInZone(iso,timeZone="America/Chicago") {
  if (!iso) return "";
  const date=new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"})
    .formatToParts(date);
  const values=Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return `${values.hour||"00"}${values.minute||"00"}`;
}

function clockMinutesInZone(iso,timeZone="America/Chicago") {
  const key=clockKeyInZone(iso,timeZone);
  if (!/^\d{4}$/.test(key)) return null;
  return Number(key.slice(0,2))*60+Number(key.slice(2));
}

function clockDistanceMinutes(a,b,timeZone="America/Chicago") {
  const aa=clockMinutesInZone(a,timeZone), bb=clockMinutesInZone(b,timeZone);
  if (aa==null || bb==null) return Infinity;
  const direct=Math.abs(aa-bb);
  return Math.min(direct,1440-direct);
}

function observationSourceEventKey(observation) {
  return cleanAuthorityText(observation?.source_event_key || observation?.sourceEventKey || "").toLowerCase();
}

function dragonFlyNativeEventKey(observation) {
  if (observation?.parser_type !== "dragonfly-public") return "";
  const key=observationSourceEventKey(observation);
  return key.startsWith("native:") ? key : "";
}

function safeIdToken(value) {
  return cleanAuthorityText(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}

export function sourceAuthorityRank(source={}) {
  if (Number.isFinite(Number(source.authority_rank))) return Number(source.authority_rank);
  if (source.parser_type === "dragonfly-public") return 10;
  if (source.source_type === "official-school" || source.source_type === "official-athletics") return 20;
  if (source.source_type === "official-conference") return 30;
  return 90;
}

export function collectionSafety({parsedCount,expectedMinGames=1,priorCount=0,minimumRetentionRatio=0.75}={}) {
  const parsed=Math.max(0,Number(parsedCount)||0);
  const expected=Math.max(1,Number(expectedMinGames)||1);
  const prior=Math.max(0,Number(priorCount)||0);
  if (parsed < expected) {
    return {safe:false,reason:`Parser returned ${parsed} games; expected at least ${expected}. Last known good data retained.`};
  }
  const safeFloor=Math.max(expected,Math.floor(prior*minimumRetentionRatio));
  if (prior && parsed < safeFloor) {
    return {safe:false,reason:`Parser returned ${parsed} games versus ${prior} previously stored; refusing destructive reconciliation. Last known good data retained.`};
  }
  return {safe:true,reason:null,safeFloor};
}

export function canonicalParticipants(observation) {
  const schoolId=observation.reporting_school_id || observation.school_id || "";
  const opponentId=observation.opponent_school_id || "";
  if (!schoolId || !opponentId || schoolId === opponentId) return null;
  const participants=[schoolId,opponentId].sort();
  let homeSchoolId=null, awaySchoolId=null;
  if (observation.home_away === "home") {
    homeSchoolId=schoolId; awaySchoolId=opponentId;
  } else if (observation.home_away === "away") {
    homeSchoolId=opponentId; awaySchoolId=schoolId;
  }
  return {participants,homeSchoolId,awaySchoolId};
}

function observationSlot(observation,timeZone="America/Chicago") {
  const dragonFlyKey=dragonFlyNativeEventKey(observation);
  if (dragonFlyKey) return `df-${safeIdToken(dragonFlyKey.replace(/^native:/,""))}`;
  if (observation?.scheduled_time_known && observation?.scheduled_at) {
    const clock=clockKeyInZone(observation.scheduled_at,timeZone);
    if (clock) return `t${clock}`;
  }
  return "tba";
}

export function canonicalCandidateKey(observation, timeZone="America/Chicago") {
  const p=canonicalParticipants(observation);
  if (!p) return null;
  const date=dateKeyInZone(observation.scheduled_at,timeZone);
  if (!date) return null;
  return [
    String(observation.sport||"").toLowerCase(),
    String(observation.gender||"").toLowerCase(),
    String(observation.season||""),
    p.participants[0],p.participants[1],date,observationSlot(observation,timeZone)
  ].join("|");
}

function normalizeVenue(value) {
  return cleanAuthorityText(value).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

function minutesBetween(a,b) {
  const aa=Date.parse(a), bb=Date.parse(b);
  return Number.isFinite(aa)&&Number.isFinite(bb)?Math.abs(aa-bb)/60000:Infinity;
}

function canonicalScore(observation) {
  const p=canonicalParticipants(observation);
  if (!p || observation.status !== "FINAL") return {homeScore:null,awayScore:null};
  const teamScore=observation.team_score;
  const opponentScore=observation.opponent_score;
  if (teamScore == null || opponentScore == null || !p.homeSchoolId) return {homeScore:null,awayScore:null};
  return observation.home_away === "home"
    ? {homeScore:Number(teamScore),awayScore:Number(opponentScore)}
    : {homeScore:Number(opponentScore),awayScore:Number(teamScore)};
}

export function observationsLikelySameEvent(a,b,{timeZone="America/Chicago",maxDateDistanceHours=36,maxTimeDisagreementMinutes=90}={}) {
  const pa=canonicalParticipants(a), pb=canonicalParticipants(b);
  if (!pa || !pb) return false;
  if (String(a.sport||"").toLowerCase() !== String(b.sport||"").toLowerCase()) return false;
  if (String(a.gender||"").toLowerCase() !== String(b.gender||"").toLowerCase()) return false;
  if (String(a.season||"") !== String(b.season||"")) return false;
  if (pa.participants.join("|") !== pb.participants.join("|")) return false;

  const aDragonFly=dragonFlyNativeEventKey(a), bDragonFly=dragonFlyNativeEventKey(b);
  if (aDragonFly && bDragonFly) return aDragonFly===bDragonFly;

  const aSource=cleanAuthorityText(a.source_id), bSource=cleanAuthorityText(b.source_id);
  const aEvent=observationSourceEventKey(a), bEvent=observationSourceEventKey(b);
  if (aSource && aSource===bSource && aEvent && bEvent && aEvent!==bEvent) return false;

  const sameDate=dateKeyInZone(a.scheduled_at,timeZone) === dateKeyInZone(b.scheduled_at,timeZone);
  const bothTimed=Boolean(a.scheduled_time_known && b.scheduled_time_known && a.scheduled_at && b.scheduled_at);
  if (sameDate) {
    if (!bothTimed) return true;
    return minutesBetween(a.scheduled_at,b.scheduled_at) <= maxTimeDisagreementMinutes;
  }

  const distance=Math.abs(Date.parse(a.scheduled_at)-Date.parse(b.scheduled_at));
  if (!Number.isFinite(distance) || distance > maxDateDistanceHours*60*60*1000) return false;
  if (bothTimed && clockDistanceMinutes(a.scheduled_at,b.scheduled_at,timeZone) > maxTimeDisagreementMinutes) return false;
  if (pa.homeSchoolId && pb.homeSchoolId && pa.homeSchoolId!==pb.homeSchoolId) return false;
  return true;
}

export function detectEventConflicts(observations,{timeZone="America/Chicago"}={}) {
  const conflicts=[];
  if (!Array.isArray(observations) || observations.length < 2) return conflicts;
  const values={DATE:new Map(),TIME:new Map(),HOME_AWAY:new Map(),VENUE:new Map(),STATUS:new Map(),SCORE:new Map()};
  for (const o of observations) {
    const p=canonicalParticipants(o);
    const date=dateKeyInZone(o.scheduled_at,timeZone);
    if (date) values.DATE.set(date,true);
    if (o.scheduled_time_known && o.scheduled_at) values.TIME.set(o.scheduled_at,true);
    if (p?.homeSchoolId && p?.awaySchoolId) values.HOME_AWAY.set(`${p.homeSchoolId}|${p.awaySchoolId}`,true);
    const venue=normalizeVenue(o.venue || o.location_text);
    if (venue && venue !== "tbd") values.VENUE.set(venue,true);
    if (o.status) values.STATUS.set(String(o.status).toUpperCase(),true);
    const score=canonicalScore(o);
    if (score.homeScore != null && score.awayScore != null) values.SCORE.set(`${score.homeScore}-${score.awayScore}`,true);
  }
  for (const [type,map] of Object.entries(values)) if (map.size > 1) conflicts.push({type,values:[...map.keys()]});
  return conflicts;
}

function bestObservation(observations,predicate=()=>true) {
  return [...observations]
    .filter(predicate)
    .sort((a,b)=>sourceAuthorityRank(a)-sourceAuthorityRank(b) || String(a.source_id||"").localeCompare(String(b.source_id||"")))[0] || null;
}

function canonicalEventSlot(observations,selected,timeSelected,timeZone) {
  const dragonFly=bestObservation(observations,o=>Boolean(dragonFlyNativeEventKey(o)));
  if (dragonFly) return observationSlot(dragonFly,timeZone);
  if (timeSelected?.scheduled_time_known) return observationSlot(timeSelected,timeZone);
  return observationSlot(selected,timeZone);
}

export function resolveCanonicalEvent(observations,{timeZone="America/Chicago",now=new Date().toISOString()}={}) {
  if (!Array.isArray(observations) || !observations.length) throw new Error("At least one observation is required");
  const usable=observations.filter(o=>canonicalParticipants(o));
  if (!usable.length) throw new Error("Canonical reconciliation requires resolved school identities");
  const first=usable[0];
  if (!usable.every(o=>observationsLikelySameEvent(first,o,{timeZone}))) throw new Error("Observations do not describe the same event");
  const p=canonicalParticipants(first);
  const selected=bestObservation(usable);
  const timeSelected=bestObservation(usable,o=>o.scheduled_time_known && o.scheduled_at) || selected;
  const relationSelected=bestObservation(usable,o=>canonicalParticipants(o)?.homeSchoolId);
  const venueSelected=bestObservation(usable,o=>cleanAuthorityText(o.venue || o.location_text));
  const scoreSelected=bestObservation(usable,o=>o.status === "FINAL" && o.team_score != null && o.opponent_score != null);
  const conflicts=detectEventConflicts(usable,{timeZone});
  const relation=canonicalParticipants(relationSelected || selected);
  const score=scoreSelected?canonicalScore(scoreSelected):{homeScore:null,awayScore:null};
  const distinctSources=new Set(usable.map(o=>o.source_id).filter(Boolean));
  const hasDragonFly=usable.some(o=>o.parser_type === "dragonfly-public");
  let trustState=distinctSources.size > 1 ? "CORROBORATED" : hasDragonFly ? "AUTHORITATIVE_LIVE" : "SINGLE_SOURCE_LIVE";
  if (conflicts.length) trustState="CONFLICT";
  const scheduledAt=timeSelected?.scheduled_at || selected.scheduled_at;
  const canonicalDate=dateKeyInZone(selected.scheduled_at,timeZone).replace(/-/g,"");
  const slot=canonicalEventSlot(usable,selected,timeSelected,timeZone);
  const id=["ce",String(first.sport||"").toLowerCase(),String(first.gender||"").toLowerCase(),first.season,p.participants[0],p.participants[1],canonicalDate,slot].join(":");
  return {
    id,
    sport:first.sport,gender:first.gender,season:first.season,
    participantA:p.participants[0],participantB:p.participants[1],
    homeSchoolId:relation?.homeSchoolId || null,awaySchoolId:relation?.awaySchoolId || null,
    scheduledAt,scheduledTimeKnown:Boolean(timeSelected?.scheduled_time_known),
    venue:cleanAuthorityText(venueSelected?.venue || venueSelected?.location_text),
    status:String(selected.status||"SCHEDULED").toUpperCase(),
    homeScore:score.homeScore,awayScore:score.awayScore,
    selectedSourceId:selected.source_id || null,
    trustState,conflicts,resolvedAt:now,
    resolutionEvidence:{
      selectedObservationId:selected.id || null,
      timeObservationId:timeSelected?.id || null,
      relationObservationId:(relationSelected||selected)?.id || null,
      venueObservationId:venueSelected?.id || null,
      scoreObservationId:scoreSelected?.id || null,
      sourceIds:[...distinctSources],
      eventSlot:slot
    }
  };
}

export function deriveSourceHealth(source,{now=new Date()}={}) {
  const checked=source.last_checked_at?Date.parse(source.last_checked_at):NaN;
  const success=source.last_successful_fetch_at?Date.parse(source.last_successful_fetch_at):NaN;
  if (!Number.isFinite(checked) && !Number.isFinite(success)) return "NEVER_FETCHED";
  const failures=Number(source.consecutive_failures||0);
  if (failures >= 3) return "FAILING";
  const staleMinutes=Number(source.stale_after_minutes || Math.max(Number(source.refresh_minutes||360)*3,720));
  if (!Number.isFinite(success) || now.getTime()-success > staleMinutes*60000) return "STALE";
  if (Number(source.active_conflict_count||0) > 0) return "CONFLICT";
  if (failures > 0 || Number(source.suspicious_game_count||0) === 1) return "DEGRADED";
  return "HEALTHY";
}

export function sameClockWithinMinutes(a,b,toleranceMinutes=2) {
  return minutesBetween(a,b) <= toleranceMinutes;
}
