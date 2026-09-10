import {
  M7_AUG17_FINAL_TARGETS,
  m7Aug17ReportingObservations,
  planM7Aug17VolleyballFinalRepair
} from "./m7-volleyball-final-repair-plan.js";

export const M7_AUG17_APPROVED_FINGERPRINT="m7-aug17-ae53a9b4";
export const M7_AUG17_EXPECTED_ROWS_WRITTEN=14;
const SOURCE_URL="https://www.maxpreps.com/ar/volleyball/scores/";
const NOTES="Secondary final from MaxPreps statewide scores";

function changeCount(result){
  return Number(result?.meta?.changes ?? result?.changes ?? result?.meta?.rows_written ?? 0);
}
function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written ?? result?.changes ?? 0);}

function placeholders(rowCount,columnCount){
  return Array.from({length:rowCount},()=>`(${Array(columnCount).fill("?").join(",")})`).join(",");
}

export async function executeM7Aug17VolleyballFinalRepair(env,{
  approvedFingerprint=M7_AUG17_APPROVED_FINGERPRINT,
  now=new Date()
}={}){
  const before=await planM7Aug17VolleyballFinalRepair(env);
  if(approvedFingerprint!==M7_AUG17_APPROVED_FINGERPRINT){
    throw new Error("M7 repair request fingerprint is not the approved fingerprint");
  }
  if(before.plan_fingerprint!==M7_AUG17_APPROVED_FINGERPRINT){
    throw new Error(`M7 repair live-state fingerprint changed: expected ${M7_AUG17_APPROVED_FINGERPRINT}, got ${before.plan_fingerprint}`);
  }
  if(!before.safe_to_execute || before.blockers?.length){
    throw new Error(`M7 repair blocked: ${(before.blockers||[]).join(";")||"planner marked unsafe"}`);
  }
  if(Number(before.expected_rows_written_if_approved)!==M7_AUG17_EXPECTED_ROWS_WRITTEN){
    throw new Error(`M7 repair write scope changed: expected ${M7_AUG17_EXPECTED_ROWS_WRITTEN}, got ${before.expected_rows_written_if_approved}`);
  }

  const checkedAt=now.toISOString();
  const observations=m7Aug17ReportingObservations();
  const canonicalById=new Map(before.canonical_plan.map(row=>[row.canonical_event_id,row.current]));

  const sourceRows=observations.map(row=>[
    row.source_id,row.team_id,SOURCE_URL,"secondary",9,"maxpreps-scores","1","America/Chicago",
    1,1440,60,0,80,2880,checkedAt,checkedAt,200,checkedAt
  ]);
  const sourceStmt=env.DB.prepare(`
    INSERT INTO sources
      (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,
       expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,
       last_successful_fetch_at,last_checked_at,last_http_status,updated_at)
    VALUES ${placeholders(sourceRows.length,18)}
  `).bind(...sourceRows.flat());

  const gameRows=observations.map(row=>{
    const canonical=canonicalById.get(row.canonical_event_id);
    if(!canonical?.scheduled_at) throw new Error(`Missing canonical scheduled_at for ${row.canonical_event_id}`);
    return [
      row.game_id,row.team_id,row.source_id,row.source_event_key,row.opponent_name,row.opponent_school_id,
      canonical.scheduled_at,0,null,null,null,null,row.home_away,0,1,"FINAL",row.team_score,row.opponent_score,row.result,
      NOTES,SOURCE_URL,checkedAt,checkedAt,checkedAt,row.canonical_event_id
    ];
  });
  const gameStmt=env.DB.prepare(`
    INSERT INTO games
      (id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,
       venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,
       team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES ${placeholders(gameRows.length,25)}
  `).bind(...gameRows.flat());

  const memberRows=observations.map(row=>[
    row.canonical_event_id,row.game_id,row.source_id,row.team_id,checkedAt
  ]);
  const memberStmt=env.DB.prepare(`
    INSERT INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
    VALUES ${placeholders(memberRows.length,5)}
  `).bind(...memberRows.flat());

  const first=M7_AUG17_FINAL_TARGETS[0];
  const second=M7_AUG17_FINAL_TARGETS[1];
  const firstScoreObservation=observations.find(row=>row.canonical_event_id===first.canonical_event_id&&row.home_away==="home");
  const secondScoreObservation=observations.find(row=>row.canonical_event_id===second.canonical_event_id&&row.home_away==="home");
  const canonicalStmt=env.DB.prepare(`
    UPDATE canonical_events
    SET status='FINAL',
        home_score=CASE id WHEN ? THEN ? WHEN ? THEN ? END,
        away_score=CASE id WHEN ? THEN ? WHEN ? THEN ? END,
        trust_state='CORROBORATED',
        conflict_count=0,
        resolution_json=json_set(
          CASE WHEN json_valid(resolution_json) THEN resolution_json ELSE '{}' END,
          '$.scoreObservationId',CASE id WHEN ? THEN ? WHEN ? THEN ? END,
          '$.sourceIds',json(COALESCE((
            SELECT json_group_array(source_id)
            FROM (
              SELECT DISTINCT source_id
              FROM canonical_event_members
              WHERE canonical_event_id=canonical_events.id
              ORDER BY source_id
            )
          ),'[]')),
          '$.m7RepairFingerprint',?
        ),
        last_reconciled_at=?,
        updated_at=?
    WHERE status='SCHEDULED'
      AND home_score IS NULL
      AND away_score IS NULL
      AND conflict_count=0
      AND trust_state='CORROBORATED'
      AND (
        (id=? AND selected_source_id=?)
        OR
        (id=? AND selected_source_id=?)
      )
  `).bind(
    first.canonical_event_id,first.home.score,second.canonical_event_id,second.home.score,
    first.canonical_event_id,first.away.score,second.canonical_event_id,second.away.score,
    first.canonical_event_id,firstScoreObservation.game_id,second.canonical_event_id,secondScoreObservation.game_id,
    M7_AUG17_APPROVED_FINGERPRINT,checkedAt,checkedAt,
    first.canonical_event_id,"df-smxrh2-volleyball-2026-dragonfly-statewide",
    second.canonical_event_id,"df-qyakr5-volleyball-2026-dragonfly-statewide"
  );

  const writeResults=await env.DB.batch([sourceStmt,gameStmt,memberStmt,canonicalStmt]);
  const perStatement=writeResults.map((result,index)=>({
    statement:index+1,
    changes:changeCount(result),
    rows_read:rowsRead(result),
    rows_written:rowsWritten(result)
  }));
  const totalChanges=perStatement.reduce((sum,row)=>sum+row.changes,0);
  const totalRowsWritten=perStatement.reduce((sum,row)=>sum+row.rows_written,0);
  if(totalChanges!==M7_AUG17_EXPECTED_ROWS_WRITTEN){
    throw new Error(`M7 repair changed ${totalChanges} rows; expected ${M7_AUG17_EXPECTED_ROWS_WRITTEN}`);
  }
  if(totalRowsWritten!==M7_AUG17_EXPECTED_ROWS_WRITTEN){
    throw new Error(`M7 repair D1 rows_written=${totalRowsWritten}; expected ${M7_AUG17_EXPECTED_ROWS_WRITTEN}`);
  }

  const after=await planM7Aug17VolleyballFinalRepair(env);
  const verificationFailures=[];
  if(!after.safe_to_execute) verificationFailures.push(...(after.blockers||[]));
  if(Number(after.expected_rows_written_if_approved)!==0) verificationFailures.push(`remaining_write_scope=${after.expected_rows_written_if_approved}`);
  for(const row of after.canonical_plan||[]) if(row.state!=="ALREADY_CONVERGED") verificationFailures.push(`${row.contest_id}:${row.state}`);
  for(const row of after.game_plan||[]) if(row.action!=="NONE") verificationFailures.push(`${row.game_id}:game_${row.action}`);
  for(const row of after.source_plan||[]) if(row.insert_required) verificationFailures.push(`${row.source_id}:source_missing`);
  for(const row of after.member_plan||[]) if(row.insert_required) verificationFailures.push(`${row.game_id}:member_missing`);
  if(verificationFailures.length) throw new Error(`M7 repair verification failed: ${verificationFailures.join(";")}`);

  return {
    status:"SUCCESS",
    approved_fingerprint:M7_AUG17_APPROVED_FINGERPRINT,
    cohort:"2026-08-17-local-local-stale-finals",
    contests:M7_AUG17_FINAL_TARGETS.map(row=>({
      contest_id:row.contest_id,
      home:row.home.name,away:row.away.name,
      final:`${row.home.score}-${row.away.score}`,
      canonical_event_id:row.canonical_event_id
    })),
    d1:{
      preflight:before.d1,
      repair:{statements:4,changes:totalChanges,rows_written:totalRowsWritten,per_statement:perStatement},
      verification:after.d1
    },
    post_repair:{
      safe_to_execute:after.safe_to_execute,
      expected_rows_written_if_replayed:after.expected_rows_written_if_approved,
      canonical_states:(after.canonical_plan||[]).map(row=>({contest_id:row.contest_id,state:row.state,status:row.current?.status,home_score:row.current?.home_score,away_score:row.current?.away_score})),
      remaining_blockers:after.blockers||[]
    },
    invariants:{
      team_records_modified:false,
      standings_modified:false,
      event_conflicts_modified:false,
      selected_canonical_source_retained:"dragonfly-public"
    }
  };
}
