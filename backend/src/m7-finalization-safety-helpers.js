const TIME_ZONE="America/Chicago";
const DUPLICATE_MAX_MINUTES=15;
const ORPHAN_MAX_MINUTES=360;

function localDate(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function minutesApart(a,b){
  const left=new Date(a).getTime(),right=new Date(b).getTime();
  if(!Number.isFinite(left)||!Number.isFinite(right)) return Infinity;
  return Math.abs(left-right)/60000;
}
function pairKey(a,b,date){return `${[String(a||""),String(b||"")].sort().join("|")}|${date||""}`;}
function scoreBySchool(event){
  if(event.home_score==null||event.away_score==null) return null;
  return new Map([[String(event.home_school_id),Number(event.home_score)],[String(event.away_school_id),Number(event.away_score)]]);
}
function scoreKey(event){
  const scores=scoreBySchool(event);
  if(!scores) return null;
  return [String(event.participant_a_school_id),String(event.participant_b_school_id)]
    .sort().map(id=>`${id}:${scores.get(id)}`).join("|");
}
function eventFinal(event){return event.status==="FINAL"&&event.home_score!=null&&event.away_score!=null;}
function validGeo(latitude,longitude){
  const lat=Number(latitude),lon=Number(longitude);
  return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat!==0||lon!==0);
}
function chooseKeeper(events=[]){
  return [...events].sort((a,b)=>
    Number(a.selected_authority_rank??999)-Number(b.selected_authority_rank??999)
    || Number(b.member_count||0)-Number(a.member_count||0)
    || Number(b.status==="FINAL")-Number(a.status==="FINAL")
    || Number(b.scheduled_time_known||0)-Number(a.scheduled_time_known||0)
    || String(a.id).localeCompare(String(b.id))
  )[0];
}

export function planDuplicateCanonicalMerges(canonicals=[],members=[],activeConflicts=[]){
  const byEventMembers=new Map();
  for(const row of members){
    if(!byEventMembers.has(row.canonical_event_id)) byEventMembers.set(row.canonical_event_id,[]);
    byEventMembers.get(row.canonical_event_id).push(row);
  }
  const conflictsByEvent=new Map();
  for(const row of activeConflicts){
    if(!conflictsByEvent.has(row.canonical_event_id)) conflictsByEvent.set(row.canonical_event_id,new Set());
    conflictsByEvent.get(row.canonical_event_id).add(String(row.conflict_type||"").toUpperCase());
  }
  const grouped=new Map();
  for(const original of canonicals){
    const event={...original,member_count:(byEventMembers.get(original.id)||[]).length};
    const key=pairKey(event.participant_a_school_id,event.participant_b_school_id,localDate(event.scheduled_at));
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(event);
  }
  const merges=[],blocked=[];
  for(const [key,events] of grouped){
    if(events.length<2) continue;
    const ordered=[...events].sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)||String(a.id).localeCompare(String(b.id)));
    const clusters=[];
    for(const event of ordered){
      const last=clusters.at(-1);
      if(last&&minutesApart(last[0].scheduled_at,event.scheduled_at)<=DUPLICATE_MAX_MINUTES) last.push(event);
      else clusters.push([event]);
    }
    for(const cluster of clusters){
      if(cluster.length<2) continue;
      const finals=cluster.filter(eventFinal);
      const finalKeys=[...new Set(finals.map(scoreKey).filter(Boolean))];
      const hasScoreConflict=cluster.some(event=>conflictsByEvent.get(event.id)?.has("SCORE"));
      if(!finals.length){
        blocked.push({key,canonical_event_ids:cluster.map(row=>row.id),reason:"schedule_only_duplicate_not_proven"});
        continue;
      }
      if(finalKeys.length>1||hasScoreConflict){
        blocked.push({key,canonical_event_ids:cluster.map(row=>row.id),reason:hasScoreConflict?"active_score_conflict":"final_scores_disagree"});
        continue;
      }
      const keeper=chooseKeeper(cluster);
      const scoreSource=chooseKeeper(finals);
      const scores=scoreBySchool(scoreSource);
      const losers=cluster.filter(row=>row.id!==keeper.id);
      merges.push({
        key,keeper_id:keeper.id,loser_ids:losers.map(row=>row.id),
        member_rows_to_move:losers.reduce((sum,row)=>sum+(byEventMembers.get(row.id)||[]).length,0),
        desired:{
          id:keeper.id,status:"FINAL",
          home_score:scores.get(String(keeper.home_school_id)),
          away_score:scores.get(String(keeper.away_school_id)),
          latitude:validGeo(keeper.latitude,keeper.longitude)?Number(keeper.latitude):null,
          longitude:validGeo(keeper.latitude,keeper.longitude)?Number(keeper.longitude):null
        }
      });
    }
  }
  return {merges,blocked};
}

function orphanMatchesCanonical(orphan,event){
  const eventDate=localDate(event.scheduled_at),gameDate=localDate(orphan.scheduled_at);
  if(!eventDate||eventDate!==gameDate) return false;
  const schools=new Set([String(event.participant_a_school_id),String(event.participant_b_school_id)]);
  if(!schools.has(String(orphan.reporting_school_id))||!schools.has(String(orphan.opponent_school_id))) return false;
  if(!eventFinal(event)) return false;
  const scores=scoreBySchool(event);
  if(Number(scores.get(String(orphan.reporting_school_id)))!==Number(orphan.team_score)) return false;
  if(Number(scores.get(String(orphan.opponent_school_id)))!==Number(orphan.opponent_score)) return false;
  if(Number(event.scheduled_time_known||0)===0||Number(orphan.scheduled_time_known||0)===0) return true;
  return minutesApart(orphan.scheduled_at,event.scheduled_at)<=ORPHAN_MAX_MINUTES;
}

export function planOrphanAttachments(orphans=[],canonicals=[],members=[]){
  const existingReporting=new Map();
  for(const member of members){
    const key=`${member.canonical_event_id}|${member.reporting_team_id}`;
    existingReporting.set(key,(existingReporting.get(key)||0)+1);
  }
  const attachments=[],blocked=[];
  for(const orphan of orphans){
    const candidates=canonicals.filter(event=>orphanMatchesCanonical(orphan,event));
    if(candidates.length!==1){
      blocked.push({game_id:orphan.id,reason:candidates.length?"multiple_exact_canonical_matches":"no_exact_canonical_match",candidate_ids:candidates.map(row=>row.id)});
      continue;
    }
    const target=candidates[0];
    attachments.push({game_id:orphan.id,canonical_event_id:target.id,team_id:orphan.team_id,source_id:orphan.source_id,already_reporting_members:existingReporting.get(`${target.id}|${orphan.team_id}`)||0});
  }
  return {attachments,blocked};
}

export function planCoordinateUpdates(canonicals=[],members=[]){
  const membersByEvent=new Map();
  for(const member of members){
    if(!validGeo(member.latitude,member.longitude)) continue;
    if(!membersByEvent.has(member.canonical_event_id)) membersByEvent.set(member.canonical_event_id,[]);
    membersByEvent.get(member.canonical_event_id).push(member);
  }
  const updates=[],blocked=[];
  for(const event of canonicals){
    if(!eventFinal(event)||validGeo(event.latitude,event.longitude)) continue;
    const rows=membersByEvent.get(event.id)||[];
    if(!rows.length) continue;
    const selected=rows.find(row=>row.source_id===event.selected_source_id);
    if(selected){updates.push({canonical_event_id:event.id,latitude:Number(selected.latitude),longitude:Number(selected.longitude),evidence:"selected_source_member"});continue;}
    const distinct=new Map();
    for(const row of rows){
      const key=`${Number(row.latitude).toFixed(4)},${Number(row.longitude).toFixed(4)}`;
      if(!distinct.has(key)) distinct.set(key,row);
    }
    if(distinct.size===1){
      const row=[...distinct.values()][0];
      updates.push({canonical_event_id:event.id,latitude:Number(row.latitude),longitude:Number(row.longitude),evidence:"unanimous_member_location"});
    } else blocked.push({canonical_event_id:event.id,reason:"member_locations_disagree",locations:[...distinct.keys()]});
  }
  return {updates,blocked};
}
