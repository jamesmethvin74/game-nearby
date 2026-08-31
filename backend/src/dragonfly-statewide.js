import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { collectionSafety, dateKeyInZone, normalizeSchoolAlias } from "./schedule-authority-core.js";

const STATE_ID="dragonfly:ArkAA:2026:WVB_Varsity";
const DEFAULT_FEED="https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0";

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function safe(value){return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function score(value){
  if (value===null || value===undefined || value==="") return null;
  const n=Number(String(value).replace(/[^0-9.-]/g,""));
  return Number.isFinite(n)?n:null;
}
function resultCode(teamScore,opponentScore,explicit){
  const code=clean(explicit).toUpperCase();
  if (/^[WLT]$/.test(code)) return code;
  if (teamScore==null || opponentScore==null) return null;
  return teamScore===opponentScore?"T":teamScore>opponentScore?"W":"L";
}
function eventIsVarsityVolleyball(event){
  const sports=Array.isArray(event?.associatedSports)?event.associatedSports:[];
  if (!sports.length) return true;
  return sports.some(item=>{
    const code=clean(item?.code).toUpperCase();
    const name=clean(item?.name).toLowerCase();
    const level=clean(item?.level).toLowerCase();
    return (code==="WVB" || name.includes("volleyball")) && (!level || level.includes("varsity"));
  });
}
function eventTimeKnown(event){return !Boolean(event?.timeTba || event?.timeTBD || event?.isTimeTba || event?.isTimeTBD);}

export function buildStatewideDragonFlyRows(payload,mappings,{checkedAt=new Date().toISOString(),timeZone="America/Chicago"}={}){
  const byExternalTeam=mappings instanceof Map?mappings:new Map(mappings.map(mapping=>[String(mapping.external_team_id),mapping]));
  const games=[];
  const canonicals=[];
  const members=[];
  const counts=new Map();
  const seenGames=new Set();
  const seenCanonical=new Set();
  const schedule=Array.isArray(payload?.schedule)?payload.schedule:[];

  for (const event of schedule) {
    if (!eventIsVarsityVolleyball(event)) continue;
    const eventId=clean(event?.eventId || event?.id);
    const scheduledAt=clean(event?.date || event?.startDateTime || event?.scheduledAt);
    if (!eventId || !scheduledAt || !Number.isFinite(Date.parse(scheduledAt))) continue;
    const participants=(Array.isArray(event?.participants)?event.participants:[]).map(participant=>{
      const externalTeamId=clean(participant?.team?.teamId);
      const mapping=byExternalTeam.get(externalTeamId);
      return mapping?{participant,mapping,externalTeamId}:null;
    }).filter(Boolean);
    const bySchool=new Map();
    for (const item of participants) if (!bySchool.has(item.mapping.school_id)) bySchool.set(item.mapping.school_id,item);
    const schoolParticipants=[...bySchool.values()];
    if (schoolParticipants.length<2) continue;

    const homeItem=schoolParticipants.find(item=>item.participant?.isHome===true) || null;
    const awayItem=schoolParticipants.find(item=>item.participant?.isHome===false) || null;
    const primaryA=homeItem || schoolParticipants[0];
    const primaryB=awayItem && awayItem.mapping.school_id!==primaryA.mapping.school_id
      ? awayItem
      : schoolParticipants.find(item=>item.mapping.school_id!==primaryA.mapping.school_id);
    if (!primaryB) continue;
    const schoolIds=[primaryA.mapping.school_id,primaryB.mapping.school_id].sort();
    const date=dateKeyInZone(scheduledAt,timeZone).replace(/-/g,"");
    if (!date) continue;
    const canonicalId=`ce:volleyball:girls:2026:${schoolIds[0]}:${schoolIds[1]}:${date}:df-${safe(eventId)}`;
    const venue=clean(event?.facility?.name || event?.hostOrgName || "");
    const locationText=clean(event?.locationNotes || venue);
    const anyResult=schoolParticipants.some(item=>item.participant?.result && item.participant.result.score!==undefined);
    const explicitStatus=clean(event?.status?.name || event?.status || event?.gameStatus).toUpperCase();
    const canceled=/CANCEL/.test(explicitStatus), postponed=/POSTPON/.test(explicitStatus);
    const status=canceled?"CANCELED":postponed?"POSTPONED":anyResult||/FINAL|COMPLETE/.test(explicitStatus)?"FINAL":"SCHEDULED";
    const homeScore=homeItem?score(homeItem.participant?.result?.score):null;
    const awayScore=awayItem?score(awayItem.participant?.result?.score):null;
    const selected=homeItem || schoolParticipants[0];
    const sourceIds=[];

    for (const item of schoolParticipants) {
      const opponent=schoolParticipants.find(candidate=>candidate.mapping.school_id!==item.mapping.school_id);
      if (!opponent) continue;
      const sourceId=item.mapping.source_id;
      const gameId=`${sourceId}:native:${safe(eventId)}`;
      if (seenGames.has(gameId)) continue;
      seenGames.add(gameId);
      const teamScore=score(item.participant?.result?.score);
      const opponentScore=score(item.participant?.result?.opponentScore) ?? score(opponent.participant?.result?.score);
      const homeAway=item.participant?.isHome===true?"home":item.participant?.isHome===false?"away":"unknown";
      const result=status==="FINAL"?resultCode(teamScore,opponentScore,item.participant?.result?.code):null;
      const latitude=homeAway==="home" && Number.isFinite(Number(item.mapping.latitude))?Number(item.mapping.latitude):null;
      const longitude=homeAway==="home" && Number.isFinite(Number(item.mapping.longitude))?Number(item.mapping.longitude):null;
      games.push({
        id:gameId,team_id:item.mapping.team_id,source_id:sourceId,source_event_key:`native:${safe(eventId)}`,
        opponent:clean(opponent.participant?.name),opponent_school_id:opponent.mapping.school_id,
        scheduled_at:new Date(scheduledAt).toISOString(),scheduled_time_known:eventTimeKnown(event)?1:0,
        venue:venue||null,location_text:locationText||null,latitude,longitude,home_away:homeAway,
        conference_game:Number(Boolean(event?.conferenceGame || event?.isConference || event?.regionGame)),counts_for_record:event?.contestType==="exhibition"?0:1,
        status,team_score:teamScore,opponent_score:opponentScore,result,notes:clean(event?.locationNotes)||null,
        source_url:item.mapping.source_url,source_updated_at:clean(payload?.timestamp)||checkedAt,last_checked_at:checkedAt,updated_at:checkedAt,
        canonical_event_id:canonicalId
      });
      members.push({canonical_event_id:canonicalId,game_id:gameId,source_id:sourceId,reporting_team_id:item.mapping.team_id,added_at:checkedAt});
      counts.set(sourceId,(counts.get(sourceId)||0)+1);
      sourceIds.push(sourceId);
    }

    if (!seenCanonical.has(canonicalId)) {
      seenCanonical.add(canonicalId);
      const geoHome=homeItem?.mapping;
      const latitude=geoHome && Number.isFinite(Number(geoHome.latitude))?Number(geoHome.latitude):null;
      const longitude=geoHome && Number.isFinite(Number(geoHome.longitude))?Number(geoHome.longitude):null;
      canonicals.push({
        id:canonicalId,sport:"volleyball",gender:"girls",season:"2026",
        participant_a_school_id:schoolIds[0],participant_b_school_id:schoolIds[1],
        home_school_id:homeItem?.mapping.school_id||null,away_school_id:awayItem?.mapping.school_id||null,
        scheduled_at:new Date(scheduledAt).toISOString(),scheduled_time_known:eventTimeKnown(event)?1:0,
        venue:venue||null,location_text:locationText||null,latitude,longitude,
        conference_game:Number(Boolean(event?.conferenceGame || event?.isConference || event?.regionGame)),status,
        home_score:status==="FINAL"?homeScore:null,away_score:status==="FINAL"?awayScore:null,
        selected_source_id:selected?.mapping.source_id||sourceIds[0]||null,
        trust_state:sourceIds.length>1?"CORROBORATED":"AUTHORITATIVE_LIVE",conflict_count:0,
        resolution_json:JSON.stringify({provider:"dragonfly",eventId,sourceIds:[...new Set(sourceIds)],mode:"statewide-bulk"}),
        last_reconciled_at:checkedAt,updated_at:checkedAt
      });
    }
  }
  return {games,canonicals,members,sourceCounts:counts,rawEventCount:schedule.length};
}

const UPSERT_GAMES_SQL=`
  INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
  SELECT
    json_extract(value,'$.id'),json_extract(value,'$.team_id'),json_extract(value,'$.source_id'),json_extract(value,'$.source_event_key'),
    json_extract(value,'$.opponent'),json_extract(value,'$.opponent_school_id'),json_extract(value,'$.scheduled_at'),json_extract(value,'$.scheduled_time_known'),
    json_extract(value,'$.venue'),json_extract(value,'$.location_text'),json_extract(value,'$.latitude'),json_extract(value,'$.longitude'),
    json_extract(value,'$.home_away'),json_extract(value,'$.conference_game'),json_extract(value,'$.counts_for_record'),json_extract(value,'$.status'),
    json_extract(value,'$.team_score'),json_extract(value,'$.opponent_score'),json_extract(value,'$.result'),json_extract(value,'$.notes'),
    json_extract(value,'$.source_url'),json_extract(value,'$.source_updated_at'),json_extract(value,'$.last_checked_at'),json_extract(value,'$.updated_at'),json_extract(value,'$.canonical_event_id')
  FROM json_each(?) WHERE 1
  ON CONFLICT(source_id,source_event_key) DO UPDATE SET
    opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
    venue=excluded.venue,location_text=excluded.location_text,latitude=COALESCE(excluded.latitude,games.latitude),longitude=COALESCE(excluded.longitude,games.longitude),
    home_away=excluded.home_away,conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,status=excluded.status,
    team_score=excluded.team_score,opponent_score=excluded.opponent_score,result=excluded.result,notes=excluded.notes,source_url=excluded.source_url,
    source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at,canonical_event_id=excluded.canonical_event_id`;

const UPSERT_CANONICAL_SQL=`
  INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
  SELECT
    json_extract(value,'$.id'),json_extract(value,'$.sport'),json_extract(value,'$.gender'),json_extract(value,'$.season'),
    json_extract(value,'$.participant_a_school_id'),json_extract(value,'$.participant_b_school_id'),json_extract(value,'$.home_school_id'),json_extract(value,'$.away_school_id'),
    json_extract(value,'$.scheduled_at'),json_extract(value,'$.scheduled_time_known'),json_extract(value,'$.venue'),json_extract(value,'$.location_text'),
    json_extract(value,'$.latitude'),json_extract(value,'$.longitude'),json_extract(value,'$.conference_game'),json_extract(value,'$.status'),
    json_extract(value,'$.home_score'),json_extract(value,'$.away_score'),json_extract(value,'$.selected_source_id'),json_extract(value,'$.trust_state'),
    json_extract(value,'$.conflict_count'),json_extract(value,'$.resolution_json'),json_extract(value,'$.last_reconciled_at'),json_extract(value,'$.updated_at')
  FROM json_each(?) WHERE 1
  ON CONFLICT(id) DO UPDATE SET
    home_school_id=excluded.home_school_id,away_school_id=excluded.away_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
    venue=COALESCE(excluded.venue,canonical_events.venue),location_text=COALESCE(excluded.location_text,canonical_events.location_text),
    latitude=COALESCE(excluded.latitude,canonical_events.latitude),longitude=COALESCE(excluded.longitude,canonical_events.longitude),conference_game=excluded.conference_game,
    status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,selected_source_id=excluded.selected_source_id,
    trust_state=excluded.trust_state,conflict_count=excluded.conflict_count,resolution_json=excluded.resolution_json,last_reconciled_at=excluded.last_reconciled_at,updated_at=excluded.updated_at`;

const UPSERT_MEMBERS_SQL=`
  INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
  SELECT json_extract(value,'$.canonical_event_id'),json_extract(value,'$.game_id'),json_extract(value,'$.source_id'),json_extract(value,'$.reporting_team_id'),json_extract(value,'$.added_at')
  FROM json_each(?)`;

export async function runDragonFlyStatewideCollection(env,{
  payload=null,feedUrl=DEFAULT_FEED,stateId=STATE_ID,fetchFn=fetch,now=new Date(),expectedMinEvents=1000
}={}){
  const checkedAt=now.toISOString();
  try {
    let workingPayload=payload;
    let pagesFetched=null;
    if (!workingPayload) {
      const fetched=await fetchDragonFlyPagedPayload(feedUrl,{fetchFn,headers:{"user-agent":"LocalBleachersAR-statewide/1.0","accept":"application/json"}});
      workingPayload=fetched.payload; pagesFetched=fetched.pageCount;
    }
    const prior=await env.DB.prepare("SELECT last_event_count FROM statewide_collection_state WHERE id=?").bind(stateId).first();
    const rawEventCount=Array.isArray(workingPayload?.schedule)?workingPayload.schedule.length:0;
    const safety=collectionSafety({parsedCount:rawEventCount,expectedMinGames:expectedMinEvents,priorCount:Number(prior?.last_event_count||0),minimumRetentionRatio:0.75});
    if (!safety.safe) throw new Error(safety.reason);

    const {results:mappings}=await env.DB.prepare(`
      SELECT tei.external_team_id,src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,sch.name AS school_name,sch.latitude,sch.longitude
      FROM team_external_identities tei
      JOIN teams t ON t.id=tei.team_id
      JOIN schools sch ON sch.id=t.school_id
      JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public'
      WHERE tei.provider='dragonfly' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
        AND src.collection_mode='statewide'`).all();
    if (mappings.length<100) throw new Error(`Only ${mappings.length} statewide DragonFly team mappings are available`);

    const rows=buildStatewideDragonFlyRows(workingPayload,mappings,{checkedAt});
    if (rows.canonicals.length<500 || rows.games.length<1000) throw new Error(`Statewide normalization suspicious: ${rows.canonicals.length} canonical events / ${rows.games.length} observations`);
    const sourceHealth=[...new Set(mappings.map(mapping=>mapping.source_id))].map(sourceId=>({id:sourceId,game_count:rows.sourceCounts.get(sourceId)||0}));

    await env.DB.prepare(UPSERT_CANONICAL_SQL).bind(JSON.stringify(rows.canonicals)).run();
    await env.DB.prepare(UPSERT_GAMES_SQL).bind(JSON.stringify(rows.games)).run();
    await env.DB.prepare(UPSERT_MEMBERS_SQL).bind(JSON.stringify(rows.members)).run();
    await env.DB.prepare(`UPDATE games SET status='CANCELED',team_score=NULL,opponent_score=NULL,result=NULL,
        notes=CASE WHEN notes IS NULL OR notes='' THEN 'Removed from current statewide DragonFly schedule' ELSE notes || ' · Removed from current statewide DragonFly schedule' END,
        last_checked_at=?,updated_at=?
      WHERE source_id IN (SELECT id FROM sources WHERE collection_mode='statewide' AND parser_type='dragonfly-public')
        AND last_checked_at<>? AND status IN ('SCHEDULED','POSTPONED') AND datetime(scheduled_at)>=datetime('now','-12 hours')`)
      .bind(checkedAt,checkedAt,checkedAt).run();
    await env.DB.prepare(`WITH input AS (
        SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.game_count') AS game_count FROM json_each(?)
      ) UPDATE sources SET last_successful_fetch_at=?,last_checked_at=?,last_failure_at=NULL,last_error=NULL,last_http_status=200,
        consecutive_failures=0,last_game_count=COALESCE((SELECT game_count FROM input WHERE input.id=sources.id),0),suspicious_game_count=0,updated_at=?
      WHERE id IN (SELECT id FROM input)`).bind(JSON.stringify(sourceHealth),checkedAt,checkedAt,checkedAt).run();
    await env.DB.prepare(`INSERT INTO team_records(team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at)
      SELECT t.id,
        SUM(CASE WHEN ce.status='FINAL' AND ((ce.home_school_id=t.school_id AND ce.home_score>ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score>ce.home_score)) THEN 1 ELSE 0 END),
        SUM(CASE WHEN ce.status='FINAL' AND ((ce.home_school_id=t.school_id AND ce.home_score<ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score<ce.home_score)) THEN 1 ELSE 0 END),
        SUM(CASE WHEN ce.status='FINAL' AND ce.home_score=ce.away_score AND (ce.home_school_id=t.school_id OR ce.away_school_id=t.school_id) THEN 1 ELSE 0 END),
        SUM(CASE WHEN ce.status='FINAL' AND ce.conference_game=1 AND ((ce.home_school_id=t.school_id AND ce.home_score>ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score>ce.home_score)) THEN 1 ELSE 0 END),
        SUM(CASE WHEN ce.status='FINAL' AND ce.conference_game=1 AND ((ce.home_school_id=t.school_id AND ce.home_score<ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score<ce.home_score)) THEN 1 ELSE 0 END),
        SUM(CASE WHEN ce.status='FINAL' AND ce.conference_game=1 AND ce.home_score=ce.away_score AND (ce.home_school_id=t.school_id OR ce.away_school_id=t.school_id) THEN 1 ELSE 0 END),?
      FROM teams t JOIN sources src ON src.team_id=t.id AND src.collection_mode='statewide'
      LEFT JOIN canonical_events ce ON ce.sport=t.sport AND ce.gender=t.gender AND ce.season=t.season AND (ce.home_school_id=t.school_id OR ce.away_school_id=t.school_id)
      GROUP BY t.id
      ON CONFLICT(team_id) DO UPDATE SET wins=excluded.wins,losses=excluded.losses,ties=excluded.ties,
        conference_wins=excluded.conference_wins,conference_losses=excluded.conference_losses,conference_ties=excluded.conference_ties,calculated_at=excluded.calculated_at`).bind(checkedAt).run();

    const details={pagesFetched,canonicalEvents:rows.canonicals.length,observations:rows.games.length,sources:sourceHealth.length};
    await env.DB.prepare(`INSERT INTO statewide_collection_state
      (id,provider,feed_url,last_checked_at,last_successful_fetch_at,last_event_count,last_observation_count,last_source_count,consecutive_failures,last_error,details_json,updated_at)
      VALUES(?,'dragonfly',?,?,?,?,?,?,0,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET feed_url=excluded.feed_url,last_checked_at=excluded.last_checked_at,last_successful_fetch_at=excluded.last_successful_fetch_at,
        last_event_count=excluded.last_event_count,last_observation_count=excluded.last_observation_count,last_source_count=excluded.last_source_count,
        consecutive_failures=0,last_error=NULL,details_json=excluded.details_json,updated_at=excluded.updated_at`)
      .bind(stateId,feedUrl,checkedAt,checkedAt,rawEventCount,rows.games.length,sourceHealth.length,JSON.stringify(details),checkedAt).run();
    return {status:"SUCCESS",rawEventCount,canonicalEvents:rows.canonicals.length,observations:rows.games.length,sources:sourceHealth.length,pagesFetched};
  } catch(error) {
    const message=String(error?.message||error).slice(0,1000);
    await env.DB.prepare(`INSERT INTO statewide_collection_state(id,provider,feed_url,last_checked_at,consecutive_failures,last_error,updated_at)
      VALUES(?,'dragonfly',?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,
        consecutive_failures=statewide_collection_state.consecutive_failures+1,last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .bind(stateId,feedUrl,checkedAt,message,checkedAt).run();
    throw error;
  }
}
