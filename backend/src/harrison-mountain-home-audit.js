const CANONICAL_ID="ce:volleyball:girls:2026:df-dxgr8r:df-ht8yyh:20260825:df-69b2c51d453393061a000000";
const HARRISON_TEAM_ID="df-ht8yyh-volleyball-2026";
const MOUNTAIN_HOME_TEAM_ID="df-dxgr8r-volleyball-2026";

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

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
