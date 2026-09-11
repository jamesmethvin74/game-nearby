import { buildRecordsFromInputs } from "./record-rebuild.js";

const MAX_ROWS_READ = 100000;
const MAX_MISMATCHES = 10;

function rowsRead(result) { return Number(result?.meta?.rows_read || 0); }
function rowsWritten(result) { return Number(result?.meta?.rows_written || 0); }

const TEAM_SQL = `
  SELECT t.id,t.school_id,t.sport,t.gender,t.season,t.conference_id,
    COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
    CASE WHEN r.team_id IS NULL THEN 0 ELSE 1 END AS record_exists,
    COALESCE(r.wins,0) AS stored_wins,
    COALESCE(r.losses,0) AS stored_losses,
    COALESCE(r.ties,0) AS stored_ties,
    COALESCE(r.conference_wins,0) AS stored_conference_wins,
    COALESCE(r.conference_losses,0) AS stored_conference_losses,
    COALESCE(r.conference_ties,0) AS stored_conference_ties,
    r.calculated_at AS stored_calculated_at
  FROM teams t
  JOIN schools s ON s.id=t.school_id
  LEFT JOIN team_records r ON r.team_id=t.id
  WHERE t.active=1
    AND t.sport='volleyball'
    AND t.gender='girls'
    AND t.season='2026'
    AND s.level='high-school'
    AND s.state='AR'
    AND s.catalog_scope='local'
  ORDER BY t.id`;

const CANONICAL_SQL = `
  WITH vb_teams AS (
    SELECT t.id,t.school_id,t.sport,t.gender,t.season,t.conference_id
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    WHERE t.active=1
      AND t.sport='volleyball'
      AND t.gender='girls'
      AND t.season='2026'
      AND s.level='high-school'
      AND s.state='AR'
      AND s.catalog_scope='local'
  )
  SELECT DISTINCT ce.*,
    cem.reporting_team_id,
    hs.name AS home_name,
    aws.name AS away_name,
    1 AS counts_for_record,
    CASE
      WHEN ce.conference_game=1 THEN 1
      WHEN vt.conference_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM teams ot
        WHERE ot.active=1
          AND ot.school_id=CASE WHEN ce.home_school_id=vt.school_id THEN ce.away_school_id ELSE ce.home_school_id END
          AND ot.sport=vt.sport AND ot.gender=vt.gender AND ot.season=vt.season
          AND ot.conference_id=vt.conference_id
      ) THEN 1
      ELSE 0
    END AS effective_conference_game
  FROM vb_teams vt
  JOIN canonical_event_members cem ON cem.reporting_team_id=vt.id
  JOIN canonical_events ce ON ce.id=cem.canonical_event_id
  JOIN games mg ON mg.id=cem.game_id AND mg.team_id=cem.reporting_team_id
  LEFT JOIN schools hs ON hs.id=ce.home_school_id
  LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.status='FINAL'
    AND ce.home_score IS NOT NULL
    AND ce.away_score IS NOT NULL
    AND mg.counts_for_record=1`;

const RAW_SQL = `
  WITH vb_teams AS (
    SELECT t.id,t.school_id,t.sport,t.gender,t.season,t.conference_id
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    WHERE t.active=1
      AND t.sport='volleyball'
      AND t.gender='girls'
      AND t.season='2026'
      AND s.level='high-school'
      AND s.state='AR'
      AND s.catalog_scope='local'
  )
  SELECT g.*,src.source_type,src.parser_type,os.name AS opponent_name,
    CASE
      WHEN g.conference_game=1 THEN 1
      WHEN vt.conference_id IS NOT NULL AND g.opponent_school_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM teams ot
        WHERE ot.active=1 AND ot.school_id=g.opponent_school_id
          AND ot.sport=vt.sport AND ot.gender=vt.gender AND ot.season=vt.season
          AND ot.conference_id=vt.conference_id
      ) THEN 1
      ELSE 0
    END AS effective_conference_game
  FROM vb_teams vt
  JOIN games g ON g.team_id=vt.id
  JOIN sources src ON src.id=g.source_id
  LEFT JOIN schools os ON os.id=g.opponent_school_id
  WHERE g.canonical_event_id IS NULL
    AND g.status='FINAL'
    AND g.team_score IS NOT NULL
    AND g.opponent_score IS NOT NULL`;

function storedRecord(team) {
  return {
    wins:Number(team.stored_wins||0),
    losses:Number(team.stored_losses||0),
    ties:Number(team.stored_ties||0),
    conference_wins:Number(team.stored_conference_wins||0),
    conference_losses:Number(team.stored_conference_losses||0),
    conference_ties:Number(team.stored_conference_ties||0)
  };
}

function sameRecord(a,b) {
  return ["wins","losses","ties","conference_wins","conference_losses","conference_ties"]
    .every(key=>Number(a?.[key]||0)===Number(b?.[key]||0));
}

function compactCandidate(row) {
  return {
    canonical_event_id:row.canonical_event_id||null,
    opponent:row.opponent||row.opponent_school_id||null,
    opponent_school_id:row.opponent_school_id||null,
    scheduled_at:row.scheduled_at||null,
    status:row.status||null,
    team_score:row.team_score==null?null:Number(row.team_score),
    opponent_score:row.opponent_score==null?null:Number(row.opponent_score),
    conference_game:Number(row.conference_game||0),
    counts_for_record:Number(row.counts_for_record??1),
    source_type:row.source_type||null,
    parser_type:row.parser_type||null,
    data_trust:row.data_trust||null
  };
}

export async function diagnoseM7RecordMismatches(env) {
  const results=await env.DB.batch([
    env.DB.prepare(TEAM_SQL),
    env.DB.prepare(CANONICAL_SQL),
    env.DB.prepare(RAW_SQL)
  ]);
  const metas=results.map(result=>({rows_read:rowsRead(result),rows_written:rowsWritten(result)}));
  const d1={
    statements:results.length,
    rows_read:metas.reduce((sum,row)=>sum+row.rows_read,0),
    rows_written:metas.reduce((sum,row)=>sum+row.rows_written,0),
    per_statement:metas
  };
  if(d1.rows_written!==0) throw new Error(`record mismatch diagnostic wrote to D1: ${d1.rows_written}`);
  if(d1.rows_read>MAX_ROWS_READ) throw new Error(`record mismatch diagnostic exceeded read fuse: ${d1.rows_read}`);

  const teams=results[0]?.results||[];
  const canonicals=results[1]?.results||[];
  const raw=results[2]?.results||[];
  const built=buildRecordsFromInputs({teams,canonicals,raw});
  const storedByTeam=new Map(teams.map(team=>[String(team.id),team]));
  const mismatches=[];
  for(const item of built){
    const team=storedByTeam.get(String(item.team.id));
    const stored=storedRecord(team);
    if(Number(team?.record_exists||0)>0&&sameRecord(stored,item.record)) continue;
    mismatches.push({
      team_id:item.team.id,
      school_id:item.team.school_id,
      school_name:team?.school_name||null,
      conference_id:item.team.conference_id||null,
      record_exists:Number(team?.record_exists||0)>0,
      stored,
      rebuilt:{
        wins:Number(item.record.wins||0),
        losses:Number(item.record.losses||0),
        ties:Number(item.record.ties||0),
        conference_wins:Number(item.record.conference_wins||0),
        conference_losses:Number(item.record.conference_losses||0),
        conference_ties:Number(item.record.conference_ties||0),
        scored_finals:Number(item.record.scored_finals||0)
      },
      stored_calculated_at:team?.stored_calculated_at||null,
      candidate_count:item.candidates.length,
      candidates:item.candidates.slice(0,50).map(compactCandidate)
    });
  }
  if(mismatches.length>MAX_MISMATCHES) throw new Error(`record mismatch diagnostic found ${mismatches.length}, above fuse ${MAX_MISMATCHES}`);
  return {
    generated_at:new Date().toISOString(),
    scope:{active_local_arkansas_2026_girls_volleyball_teams:teams.length},
    inputs:{canonical_rows:canonicals.length,raw_final_rows:raw.length},
    mismatch_count:mismatches.length,
    mismatches,
    d1
  };
}
