import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { collectionSafety, dateKeyInZone } from "./schedule-authority-core.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { STATEWIDE_SQL } from "./dragonfly-statewide.js";
import { statewideSportConfig, STATEWIDE_HIGH_SCHOOL_SPORTS } from "./statewide-sport-config.js";

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
function eventTimeKnown(event){return !Boolean(event?.timeTba || event?.timeTBD || event?.isTimeTba || event?.isTimeTBD);}
function eventMatches(event,config){
  const sports=Array.isArray(event?.associatedSports)?event.associatedSports:[];
  if (!sports.length) return true;
  return sports.some(item=>{
    const code=clean(item?.code).toUpperCase();
    const level=clean(item?.level).toLowerCase();
    return code===config.providerSportCode && (!level || level.includes("varsity"));
  });
}
function hashText(value){
  let hash=2166136261;
  for (let index=0;index<value.length;index++) {
    hash^=value.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(16).padStart(8,"0");
}
function parseDetails(value){
  try { return value?JSON.parse(value):{}; }
  catch { return {}; }
}

export function certifiedStatewideSignature(payload,sportConfig){
  const config=statewideSportConfig(sportConfig);
  const schedule=Array.isArray(payload?.schedule)?payload.schedule:[];
  const events=schedule.filter(event=>eventMatches(event,config)).map(event=>({
    eventId:clean(event?.eventId || event?.id),
    scheduledAt:clean(event?.date || event?.startDateTime || event?.scheduledAt),
    timeKnown:eventTimeKnown(event)?1:0,
    status:clean(event?.status?.name || event?.status || event?.gameStatus).toUpperCase(),
    venue:clean(event?.facility?.name || event?.hostOrgName || ""),
    location:clean(event?.locationNotes || ""),
    conferenceGame:Number(Boolean(event?.conferenceGame || event?.isConference || event?.regionGame)),
    contestType:clean(event?.contestType).toLowerCase(),
    participants:(Array.isArray(event?.participants)?event.participants:[]).map(participant=>({
      teamId:clean(participant?.team?.teamId),
      orgShortCode:clean(participant?.orgShortCode).toUpperCase(),
      name:clean(participant?.name),
      isHome:participant?.isHome===true?1:participant?.isHome===false?0:null,
      score:score(participant?.result?.score),
      opponentScore:score(participant?.result?.opponentScore),
      result:clean(participant?.result?.code).toUpperCase()||null
    })).sort((a,b)=>`${a.teamId}|${a.orgShortCode}|${a.name}`.localeCompare(`${b.teamId}|${b.orgShortCode}|${b.name}`))
  })).sort((a,b)=>`${a.eventId}|${a.scheduledAt}`.localeCompare(`${b.eventId}|${b.scheduledAt}`));
  return `${config.key}:${events.length}:${hashText(JSON.stringify(events))}`;
}

function eventStatus(event,participants){
  const explicit=clean(event?.status?.name || event?.status || event?.gameStatus).toUpperCase();
  if (/CANCEL/.test(explicit)) return "CANCELED";
  if (/POSTPON/.test(explicit)) return "POSTPONED";
  const hasResult=participants.some(participant=>participant?.result && participant.result.score!==undefined);
  return hasResult || /FINAL|COMPLETE/.test(explicit) ? "FINAL" : "SCHEDULED";
}

export function buildCertifiedStatewideRows(payload,mappings,sportConfig,{checkedAt=new Date().toISOString(),timeZone="America/Chicago"}={}){
  const config=statewideSportConfig(sportConfig);
  const mappingList=mappings instanceof Map?[...mappings.values()]:mappings;
  const byExternalSchool=new Map(
    mappingList
      .filter(mapping=>clean(mapping?.external_school_id))
      .map(mapping=>[clean(mapping.external_school_id).toUpperCase(),mapping])
  );
  const byExternalTeam=new Map(
    mappingList
      .filter(mapping=>clean(mapping?.external_team_id))
      .map(mapping=>[clean(mapping.external_team_id),mapping])
  );
  const mappingForParticipant=participant=>{
    const externalSchoolId=clean(participant?.orgShortCode).toUpperCase();
    const externalTeamId=clean(participant?.team?.teamId);
    return byExternalSchool.get(externalSchoolId) || byExternalTeam.get(externalTeamId) || null;
  };
  const games=[];
  const canonicals=[];
  const members=[];
  const counts=new Map();
  const touchedTeamIds=new Set();
  const seenGames=new Set();
  const seenCanonical=new Set();
  let externalOpponentObservations=0;
  let skippedWithoutOpponent=0;
  const schedule=Array.isArray(payload?.schedule)?payload.schedule:[];

  for (const event of schedule) {
    if (!eventMatches(event,config)) continue;
    const eventId=clean(event?.eventId || event?.id);
    const scheduledAt=clean(event?.date || event?.startDateTime || event?.scheduledAt);
    if (!eventId || !scheduledAt || !Number.isFinite(Date.parse(scheduledAt))) continue;
    const participants=Array.isArray(event?.participants)?event.participants:[];
    const mapped=participants.map((participant,index)=>{
      const externalTeamId=clean(participant?.team?.teamId);
      const externalSchoolId=clean(participant?.orgShortCode).toUpperCase();
      const mapping=mappingForParticipant(participant);
      return mapping?{participant,mapping,externalTeamId,externalSchoolId,index}:null;
    }).filter(Boolean);
    if (!mapped.length) continue;

    const status=eventStatus(event,participants);
    const venue=clean(event?.facility?.name || event?.hostOrgName || "");
    const locationText=clean(event?.locationNotes || venue);
    const sourceUpdatedAt=clean(payload?.timestamp)||checkedAt;
    const mappedHome=mapped.find(item=>item.participant?.isHome===true) || null;
    const venueLatitude=mappedHome && Number.isFinite(Number(mappedHome.mapping.latitude))?Number(mappedHome.mapping.latitude):null;
    const venueLongitude=mappedHome && Number.isFinite(Number(mappedHome.mapping.longitude))?Number(mappedHome.mapping.longitude):null;
    const contestType=clean(event?.contestType).toLowerCase();
    const conferenceGame=Number(Boolean(event?.conferenceGame || event?.isConference || event?.regionGame));

    const localBySchool=new Map();
    for (const item of mapped) if (!localBySchool.has(item.mapping.school_id)) localBySchool.set(item.mapping.school_id,item);
    const localParticipants=[...localBySchool.values()];
    let canonicalId=null;
    let localA=null;
    let localB=null;
    if (localParticipants.length>=2) {
      localA=localParticipants.find(item=>item.participant?.isHome===true) || localParticipants[0];
      localB=localParticipants.find(item=>item.mapping.school_id!==localA.mapping.school_id) || null;
      if (localB) {
        const schoolIds=[localA.mapping.school_id,localB.mapping.school_id].sort();
        const date=dateKeyInZone(scheduledAt,timeZone).replace(/-/g,"");
        if (date) canonicalId=`ce:${config.sport}:${config.gender}:${config.season}:${schoolIds[0]}:${schoolIds[1]}:${date}:df-${safe(eventId)}`;
      }
    }

    const eventGames=[];
    for (const item of mapped) {
      const opponent=participants.find((participant,index)=>index!==item.index) || null;
      if (!opponent) {
        skippedWithoutOpponent++;
        continue;
      }
      const opponentMapping=mappingForParticipant(opponent);
      const localCanonical=canonicalId && opponentMapping && opponentMapping.school_id!==item.mapping.school_id ? canonicalId : null;
      if (!opponentMapping) externalOpponentObservations++;
      const sourceId=item.mapping.source_id;
      const gameId=`${sourceId}:native:${safe(eventId)}`;
      if (seenGames.has(gameId)) continue;
      seenGames.add(gameId);
      const teamScore=score(item.participant?.result?.score);
      const opponentScore=score(item.participant?.result?.opponentScore) ?? score(opponent?.result?.score);
      const homeAway=item.participant?.isHome===true?"home":item.participant?.isHome===false?"away":"unknown";
      const result=status==="FINAL"?resultCode(teamScore,opponentScore,item.participant?.result?.code):null;
      const game={
        id:gameId,
        team_id:item.mapping.team_id,
        source_id:sourceId,
        source_event_key:`native:${safe(eventId)}`,
        opponent:clean(opponent?.name)||"Opponent",
        opponent_school_id:opponentMapping?.school_id||null,
        scheduled_at:new Date(scheduledAt).toISOString(),
        scheduled_time_known:eventTimeKnown(event)?1:0,
        venue:venue||null,
        location_text:locationText||null,
        latitude:venueLatitude,
        longitude:venueLongitude,
        home_away:homeAway,
        conference_game:conferenceGame,
        counts_for_record:contestType==="exhibition"?0:1,
        status,
        team_score:teamScore,
        opponent_score:opponentScore,
        result,
        notes:clean(event?.locationNotes)||null,
        source_url:item.mapping.source_url,
        source_updated_at:sourceUpdatedAt,
        last_checked_at:checkedAt,
        updated_at:checkedAt,
        canonical_event_id:localCanonical
      };
      games.push(game);
      eventGames.push({game,item,opponentMapping});
      touchedTeamIds.add(item.mapping.team_id);
      counts.set(sourceId,(counts.get(sourceId)||0)+1);
    }

    if (canonicalId && !seenCanonical.has(canonicalId) && localA && localB) {
      seenCanonical.add(canonicalId);
      const homeItem=localParticipants.find(item=>item.participant?.isHome===true) || null;
      const awayItem=localParticipants.find(item=>item.participant?.isHome===false) || null;
      const schoolIds=[localA.mapping.school_id,localB.mapping.school_id].sort();
      const homeScore=homeItem?score(homeItem.participant?.result?.score):null;
      const awayScore=awayItem?score(awayItem.participant?.result?.score):null;
      const memberGames=eventGames.filter(item=>item.game.canonical_event_id===canonicalId);
      for (const item of memberGames) members.push({
        canonical_event_id:canonicalId,
        game_id:item.game.id,
        source_id:item.game.source_id,
        reporting_team_id:item.game.team_id,
        added_at:checkedAt
      });
      const sourceIds=[...new Set(memberGames.map(item=>item.game.source_id))];
      const selected=homeItem || localA;
      canonicals.push({
        id:canonicalId,
        sport:config.sport,
        gender:config.gender,
        season:config.season,
        participant_a_school_id:schoolIds[0],
        participant_b_school_id:schoolIds[1],
        home_school_id:homeItem?.mapping.school_id||null,
        away_school_id:awayItem?.mapping.school_id||null,
        scheduled_at:new Date(scheduledAt).toISOString(),
        scheduled_time_known:eventTimeKnown(event)?1:0,
        venue:venue||null,
        location_text:locationText||null,
        latitude:venueLatitude,
        longitude:venueLongitude,
        conference_game:conferenceGame,
        status,
        home_score:status==="FINAL"?homeScore:null,
        away_score:status==="FINAL"?awayScore:null,
        selected_source_id:selected?.mapping.source_id||sourceIds[0]||null,
        trust_state:sourceIds.length>1?"CORROBORATED":"AUTHORITATIVE_LIVE",
        conflict_count:0,
        resolution_json:JSON.stringify({provider:"dragonfly",eventId,sourceIds,mode:"statewide-certified-bulk",sport:config.key}),
        last_reconciled_at:checkedAt,
        updated_at:checkedAt
      });
    }
  }

  return {
    games,
    canonicals,
    members,
    sourceCounts:counts,
    touchedTeamIds:[...touchedTeamIds],
    rawEventCount:schedule.length,
    externalOpponentObservations,
    skippedWithoutOpponent
  };
}

async function runJsonChunks(env,sql,rows,chunkSize){
  for (let i=0;i<rows.length;i+=chunkSize) await env.DB.prepare(sql).bind(JSON.stringify(rows.slice(i,i+chunkSize))).run();
}

async function markSportSourcesChecked(env,config,checkedAt){
  return env.DB.prepare(`
    UPDATE sources SET last_successful_fetch_at=?,last_checked_at=?,last_failure_at=NULL,last_error=NULL,last_http_status=200,
      consecutive_failures=0,suspicious_game_count=0,updated_at=?
    WHERE collection_mode='statewide' AND parser_type='dragonfly-public'
      AND id LIKE '%-dragonfly-statewide'
      AND team_id IN (SELECT id FROM teams WHERE sport=? AND gender=? AND season=?)
  `).bind(checkedAt,checkedAt,checkedAt,config.sport,config.gender,config.season).run();
}

export async function runCertifiedDragonFlyStatewideCollection(env,sportConfig,{
  payload=null,fetchFn=fetch,now=new Date(),expectedMinEvents=null,minimumMappings=null,minimumObservations=null,chunkSize=400
}={}){
  const config=statewideSportConfig(sportConfig);
  const checkedAt=now.toISOString();
  const minEvents=expectedMinEvents??config.minEvents;
  const minMappings=minimumMappings??config.expectedTargets;
  const minObservations=minimumObservations??Math.max(10,Math.floor(minEvents*0.25));
  try {
    let workingPayload=payload;
    let pagesFetched=null;
    if (!workingPayload) {
      const fetched=await fetchDragonFlyPagedPayload(config.feedUrl,{fetchFn,headers:{"user-agent":"LocalBleachersAR-statewide-certified/1.0","accept":"application/json"}});
      workingPayload=fetched.payload;
      pagesFetched=fetched.pageCount;
    }

    const prior=await env.DB.prepare("SELECT last_event_count,details_json FROM statewide_collection_state WHERE id=?").bind(config.stateId).first();
    const rawEventCount=Array.isArray(workingPayload?.schedule)?workingPayload.schedule.length:0;
    const safety=collectionSafety({parsedCount:rawEventCount,expectedMinGames:minEvents,priorCount:Number(prior?.last_event_count||0),minimumRetentionRatio:0.75});
    if (!safety.safe) throw new Error(safety.reason);

    const signature=certifiedStatewideSignature(workingPayload,config);
    const previousDetails=parseDetails(prior?.details_json);
    if (prior && previousDetails.signature===signature) {
      await markSportSourcesChecked(env,config,checkedAt);
      const details={...previousDetails,pagesFetched,signature,unchanged:true};
      await env.DB.prepare(`
        UPDATE statewide_collection_state
        SET feed_url=?,last_checked_at=?,last_successful_fetch_at=?,last_event_count=?,consecutive_failures=0,last_error=NULL,details_json=?,updated_at=?
        WHERE id=?
      `).bind(config.feedUrl,checkedAt,checkedAt,rawEventCount,JSON.stringify(details),checkedAt,config.stateId).run();
      return {
        status:"NOT_MODIFIED",config,rawEventCount,
        canonicalEvents:Number(previousDetails.canonicalEvents||0),
        observations:Number(previousDetails.observations||0),
        sources:Number(previousDetails.sources||0),
        touchedTeams:0,pagesFetched,chunkSize,signature
      };
    }

    const mappingResult=await env.DB.prepare(`
      SELECT sei.external_school_id,src.id AS source_id,src.source_url,t.id AS team_id,t.school_id,
        sch.name AS school_name,sch.latitude,sch.longitude
      FROM school_external_identities sei
      JOIN teams t ON t.school_id=sei.school_id
      JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local' AND sch.level='high-school' AND sch.state='AR'
      JOIN sources src ON src.team_id=t.id AND src.parser_type='dragonfly-public' AND src.collection_mode='statewide' AND src.id=t.id || '-dragonfly-statewide'
      WHERE sei.provider='dragonfly' AND t.sport=? AND t.gender=? AND t.season=? AND t.active=1
    `).bind(config.sport,config.gender,config.season).all();
    const mappings=mappingResult.results||[];
    if (mappings.length<minMappings) throw new Error(`Only ${mappings.length} certified ${config.feedCode} school+sport mappings are available; minimum is ${minMappings}`);

    const rows=buildCertifiedStatewideRows(workingPayload,mappings,config,{checkedAt});
    if (rows.games.length<minObservations) {
      throw new Error(`Certified ${config.feedCode} normalization suspicious: ${rows.games.length} observations; minimum is ${minObservations}`);
    }

    const sourceHealth=[...new Set(mappings.map(mapping=>mapping.source_id))].map(sourceId=>({id:sourceId,game_count:rows.sourceCounts.get(sourceId)||0}));
    await runJsonChunks(env,STATEWIDE_SQL.upsertCanonical,rows.canonicals,chunkSize);
    await runJsonChunks(env,STATEWIDE_SQL.upsertGames,rows.games,chunkSize);
    await runJsonChunks(env,STATEWIDE_SQL.upsertMembers,rows.members,chunkSize);

    const sourceIdsJson=JSON.stringify(sourceHealth.map(item=>item.id));
    await env.DB.prepare(`
      UPDATE games SET status='CANCELED',team_score=NULL,opponent_score=NULL,result=NULL,
        notes=CASE WHEN notes IS NULL OR notes='' THEN 'Removed from current statewide DragonFly schedule' ELSE notes || ' · Removed from current statewide DragonFly schedule' END,
        last_checked_at=?,updated_at=?
      WHERE source_id IN (SELECT value FROM json_each(?))
        AND last_checked_at<>? AND status IN ('SCHEDULED','POSTPONED') AND datetime(scheduled_at)>=datetime('now','-12 hours')
    `).bind(checkedAt,checkedAt,sourceIdsJson,checkedAt).run();

    await env.DB.prepare(`
      WITH input AS (
        SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.game_count') AS game_count FROM json_each(?)
      )
      UPDATE sources SET last_successful_fetch_at=?,last_checked_at=?,last_failure_at=NULL,last_error=NULL,last_http_status=200,
        consecutive_failures=0,last_game_count=COALESCE((SELECT game_count FROM input WHERE input.id=sources.id),0),suspicious_game_count=0,updated_at=?
      WHERE id IN (SELECT id FROM input)
    `).bind(JSON.stringify(sourceHealth),checkedAt,checkedAt,checkedAt).run();

    const recordRebuild=await rebuildTeamRecords(env,rows.touchedTeamIds,checkedAt);
    const details={
      feedCode:config.feedCode,pagesFetched,canonicalEvents:rows.canonicals.length,observations:rows.games.length,
      sources:sourceHealth.length,touchedTeams:rows.touchedTeamIds.length,externalOpponentObservations:rows.externalOpponentObservations,
      skippedWithoutOpponent:rows.skippedWithoutOpponent,recordRebuild,chunkSize,signature,unchanged:false,
      mappingMode:"dragonfly-school-id+sport-feed"
    };
    await env.DB.prepare(`
      INSERT INTO statewide_collection_state
        (id,provider,feed_url,last_checked_at,last_successful_fetch_at,last_event_count,last_observation_count,last_source_count,consecutive_failures,last_error,details_json,updated_at)
      VALUES(?,'dragonfly',?,?,?,?,?,?,0,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET
        feed_url=excluded.feed_url,last_checked_at=excluded.last_checked_at,last_successful_fetch_at=excluded.last_successful_fetch_at,
        last_event_count=excluded.last_event_count,last_observation_count=excluded.last_observation_count,last_source_count=excluded.last_source_count,
        consecutive_failures=0,last_error=NULL,details_json=excluded.details_json,updated_at=excluded.updated_at
    `).bind(config.stateId,config.feedUrl,checkedAt,checkedAt,rawEventCount,rows.games.length,sourceHealth.length,JSON.stringify(details),checkedAt).run();

    return {status:"SUCCESS",config,rawEventCount,canonicalEvents:rows.canonicals.length,observations:rows.games.length,sources:sourceHealth.length,touchedTeams:rows.touchedTeamIds.length,pagesFetched,chunkSize,signature,recordRebuild};
  } catch (error) {
    const message=String(error?.message||error).slice(0,1000);
    await env.DB.prepare(`
      INSERT INTO statewide_collection_state(id,provider,feed_url,last_checked_at,consecutive_failures,last_error,updated_at)
      VALUES(?,'dragonfly',?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,
        consecutive_failures=statewide_collection_state.consecutive_failures+1,last_error=excluded.last_error,updated_at=excluded.updated_at
    `).bind(config.stateId,config.feedUrl,checkedAt,message,checkedAt).run();
    throw error;
  }
}

export async function runAllCertifiedDragonFlyStatewideCollections(env,{payloads=new Map(),...options}={}){
  const results=[];
  for (const config of STATEWIDE_HIGH_SCHOOL_SPORTS) {
    results.push(await runCertifiedDragonFlyStatewideCollection(env,config,{...options,payload:payloads.get(config.key)||null}));
  }
  return results;
}
