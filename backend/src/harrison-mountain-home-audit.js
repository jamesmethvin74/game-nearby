const CANONICAL_ID="ce:volleyball:girls:2026:df-dxgr8r:df-ht8yyh:20260825:df-69b2c51d453393061a000000";
const HARRISON_SCHOOL_ID="df-ht8yyh";
const MOUNTAIN_HOME_SCHOOL_ID="df-dxgr8r";
const HARRISON_TEAM_ID="df-ht8yyh-volleyball-2026";
const MOUNTAIN_HOME_TEAM_ID="df-dxgr8r-volleyball-2026";
const SCHEDULED_AT="2026-08-25T22:30:00.000Z";
export const HARRISON_MH_REPAIR_FINGERPRINT="harrison-mountain-home-venue-fix-v1";

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}
function normalizedVenue(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function parsedValues(row){try{return JSON.parse(row?.values_json||"[]");}catch{return [];}}

export async function readHarrisonMountainHomeAudit(env){
  const [event,members,conflicts,records]=await env.DB.batch([
    env.DB.prepare(`SELECT id,scheduled_at,status,home_school_id,away_school_id,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at FROM canonical_events WHERE id=?`).bind(CANONICAL_ID),
    env.DB.prepare(`SELECT cem.reporting_team_id,cem.game_id,cem.source_id,g.source_event_key,g.opponent,g.opponent_school_id,g.scheduled_at,g.scheduled_time_known,g.home_away,g.venue,g.location_text,g.status,g.team_score,g.opponent_score,g.result,g.counts_for_record,s.source_type,s.parser_type,s.source_priority,s.authority_rank FROM canonical_event_members cem JOIN games g ON g.id=cem.game_id JOIN sources s ON s.id=cem.source_id WHERE cem.canonical_event_id=? ORDER BY s.authority_rank,s.source_priority,cem.reporting_team_id,cem.game_id`).bind(CANONICAL_ID),
    env.DB.prepare(`SELECT id,conflict_type,values_json,evidence_json,detected_at,resolved_at FROM event_conflicts WHERE canonical_event_id=? ORDER BY id`).bind(CANONICAL_ID),
    env.DB.prepare(`SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at FROM team_records WHERE team_id IN (?,?) ORDER BY team_id`).bind(HARRISON_TEAM_ID,MOUNTAIN_HOME_TEAM_ID)
  ]);
  const results=[event,members,conflicts,records];
  const d1={statements:results.length,rows_read:results.reduce((n,r)=>n+rowsRead(r),0),rows_written:results.reduce((n,r)=>n+rowsWritten(r),0),per_statement:results.map(r=>({rows_read:rowsRead(r),rows_written:rowsWritten(r)}))};
  if(d1.rows_written!==0) throw new Error("audit unexpectedly wrote to D1");
  if(d1.rows_read>500) throw new Error(`audit read fuse exceeded: ${d1.rows_read}`);
  return {fingerprint:"harrison-mountain-home-audit-v1",canonical_id:CANONICAL_ID,event:event.results?.[0]||null,members:members.results||[],conflicts:conflicts.results||[],records:records.results||[],d1};
}

function validateMembers(members){
  if(!Array.isArray(members)||members.length<3) return false;
  let harrison=false,mountainHome=false;
  for(const m of members){
    if(m.scheduled_at!==SCHEDULED_AT||Number(m.scheduled_time_known)!==1||m.status!=="FINAL"||Number(m.counts_for_record)!==1) return false;
    const venue=normalizedVenue(m.venue||m.location_text);
    if(!["harrison high school","goblin arena"].includes(venue)) return false;
    if(m.reporting_team_id===HARRISON_TEAM_ID){
      harrison=true;
      if(m.opponent_school_id!==MOUNTAIN_HOME_SCHOOL_ID||m.home_away!=="home"||Number(m.team_score)!==1||Number(m.opponent_score)!==3||m.result!=="L") return false;
    }else if(m.reporting_team_id===MOUNTAIN_HOME_TEAM_ID){
      mountainHome=true;
      if(m.opponent_school_id!==HARRISON_SCHOOL_ID||m.home_away!=="away"||Number(m.team_score)!==3||Number(m.opponent_score)!==1||m.result!=="W") return false;
    }else return false;
  }
  return harrison&&mountainHome;
}

export async function planHarrisonMountainHomeRepair(env){
  const audit=await readHarrisonMountainHomeAudit(env);
  const event=audit.event;
  const active=audit.conflicts.filter(row=>row.resolved_at==null);
  const eventCorrect=Boolean(event&&event.id===CANONICAL_ID&&event.scheduled_at===SCHEDULED_AT&&event.status==="FINAL"&&event.home_school_id===HARRISON_SCHOOL_ID&&event.away_school_id===MOUNTAIN_HOME_SCHOOL_ID&&Number(event.home_score)===1&&Number(event.away_score)===3);
  const membersCorrect=validateMembers(audit.members);
  const activeVenueConflict=active.length===1&&active[0].conflict_type==="VENUE"&&new Set(parsedValues(active[0])).size===2&&parsedValues(active[0]).includes("harrison high school")&&parsedValues(active[0]).includes("goblin arena");
  const alreadyResolved=active.length===0&&Number(event?.conflict_count||0)===0&&event?.trust_state==="CORROBORATED";
  const repairable=activeVenueConflict&&Number(event?.conflict_count||0)===1&&event?.trust_state==="CONFLICT";
  const safe=eventCorrect&&membersCorrect&&(alreadyResolved||repairable);
  const reasons=[];
  if(!eventCorrect) reasons.push("canonical facts do not match the independently verified Harrison 1-3 Mountain Home final");
  if(!membersCorrect) reasons.push("attached observations do not unanimously support the verified final and venue alias scope");
  if(!alreadyResolved&&!repairable) reasons.push("active conflict state is not the exact verified venue-alias case");
  return {
    fingerprint:HARRISON_MH_REPAIR_FINGERPRINT,
    safe,reasons,
    action:alreadyResolved?"already_resolved":repairable?"resolve_verified_venue_alias":"blocked",
    active_conflict_id:repairable?active[0].id:null,
    event:audit.event,members:audit.members,records:audit.records,
    d1:audit.d1
  };
}

export async function executeHarrisonMountainHomeRepair(env,{fingerprint}={}){
  if(fingerprint!==HARRISON_MH_REPAIR_FINGERPRINT) throw new Error("repair fingerprint mismatch");
  const plan=await planHarrisonMountainHomeRepair(env);
  if(!plan.safe) throw new Error(`repair preflight unsafe: ${plan.reasons.join("; ")}`);
  if(plan.action==="already_resolved") return {status:"SUCCESS",fingerprint:HARRISON_MH_REPAIR_FINGERPRINT,action:"already_resolved",d1:{statements:0,rows_read:0,rows_written:0},verification:plan};
  const now=new Date().toISOString();
  const [conflictUpdate,eventUpdate]=await env.DB.batch([
    env.DB.prepare(`UPDATE event_conflicts SET resolved_at=? WHERE id=? AND canonical_event_id=? AND resolved_at IS NULL AND conflict_type='VENUE'`).bind(now,plan.active_conflict_id,CANONICAL_ID),
    env.DB.prepare(`UPDATE canonical_events SET trust_state='CORROBORATED',conflict_count=0,last_reconciled_at=?,updated_at=? WHERE id=? AND scheduled_at=? AND status='FINAL' AND home_school_id=? AND away_school_id=? AND home_score=1 AND away_score=3 AND trust_state='CONFLICT' AND conflict_count=1`).bind(now,now,CANONICAL_ID,SCHEDULED_AT,HARRISON_SCHOOL_ID,MOUNTAIN_HOME_SCHOOL_ID)
  ]);
  const writeD1={statements:2,rows_read:rowsRead(conflictUpdate)+rowsRead(eventUpdate),rows_written:rowsWritten(conflictUpdate)+rowsWritten(eventUpdate),per_statement:[{rows_read:rowsRead(conflictUpdate),rows_written:rowsWritten(conflictUpdate)},{rows_read:rowsRead(eventUpdate),rows_written:rowsWritten(eventUpdate)}]};
  if(writeD1.rows_written!==2) throw new Error(`repair write fuse expected 2 rows, wrote ${writeD1.rows_written}`);
  if(writeD1.rows_read>50) throw new Error(`repair write read fuse exceeded: ${writeD1.rows_read}`);
  const verification=await planHarrisonMountainHomeRepair(env);
  if(!verification.safe||verification.action!=="already_resolved") throw new Error("repair verification failed");
  return {status:"SUCCESS",fingerprint:HARRISON_MH_REPAIR_FINGERPRINT,action:"resolved_verified_venue_alias",d1:writeD1,verification};
}
