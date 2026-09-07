import { observationsLikelySameEvent, resolveCanonicalEvent } from "./schedule-authority-core.js";

export async function upsertResolvedObservation(env,source,game,checkedAt,{opponentSchoolId}={}) {
  if(!opponentSchoolId) throw new Error("Resolved observation requires opponentSchoolId");
  const id=`${source.id}:${game.sourceEventKey}`;
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
      venue=COALESCE(NULLIF(excluded.venue,''),games.venue),location_text=COALESCE(NULLIF(excluded.location_text,''),games.location_text),
      latitude=COALESCE(excluded.latitude,games.latitude),longitude=COALESCE(excluded.longitude,games.longitude),home_away=excluded.home_away,
      conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,status=excluded.status,
      team_score=excluded.team_score,opponent_score=excluded.opponent_score,result=excluded.result,notes=excluded.notes,
      source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`)
    .bind(id,source.team_id,source.id,game.sourceEventKey,game.opponent,opponentSchoolId,game.scheduledAt,game.scheduledTimeKnown?1:0,game.venue||null,game.locationText||null,
      game.latitude??null,game.longitude??null,game.homeAway,game.conferenceGame?1:0,game.countsForRecord?1:0,game.status,game.teamScore??null,game.opponentScore??null,
      game.result||null,game.notes||null,source.source_url,game.sourceUpdatedAt||checkedAt,checkedAt,checkedAt).run();
  return id;
}

async function observationById(env,gameId) {
  return env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.id AS reporting_team_id,sch.id AS reporting_school_id,sch.name AS reporting_school_name,
      src.source_type,src.parser_type,src.source_priority,src.authority_rank,src.timezone
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id
    WHERE g.id=?`).bind(gameId).first();
}

export async function reconcileResolvedObservation(env,gameId) {
  const seed=await observationById(env,gameId);
  if(!seed?.opponent_school_id) return null;
  const timeZone=seed.timezone||"America/Chicago";
  const {results:candidates}=await env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.id AS reporting_team_id,sch.id AS reporting_school_id,sch.name AS reporting_school_name,
      src.source_type,src.parser_type,src.source_priority,src.authority_rank,src.timezone
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id
    WHERE g.opponent_school_id IS NOT NULL AND t.sport=? AND t.gender=? AND t.season=?
      AND ((sch.id=? AND g.opponent_school_id=?) OR (sch.id=? AND g.opponent_school_id=?))
      AND datetime(g.scheduled_at) BETWEEN datetime(?,'-36 hours') AND datetime(?,'+36 hours')
    ORDER BY src.authority_rank,src.source_priority,src.id`)
    .bind(seed.sport,seed.gender,seed.season,
      seed.reporting_school_id,seed.opponent_school_id,seed.opponent_school_id,seed.reporting_school_id,seed.scheduled_at,seed.scheduled_at).all();
  const related=candidates.filter(candidate=>candidate.id===seed.id || observationsLikelySameEvent(seed,candidate,{timeZone}));
  if(!related.length) return null;
  let resolved;
  try { resolved=resolveCanonicalEvent(related,{timeZone}); }
  catch { return null; }

  const now=new Date().toISOString();
  const selected=related.find(o=>o.id===resolved.resolutionEvidence.selectedObservationId)||related[0];
  const venueObservation=related.find(o=>o.id===resolved.resolutionEvidence.venueObservationId)||selected;
  const geoObservation=related.find(o=>o.latitude!=null&&o.longitude!=null)||selected;
  const conferenceGame=Number(selected?.conference_game||0);

  await env.DB.prepare(`
    INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET home_school_id=excluded.home_school_id,away_school_id=excluded.away_school_id,scheduled_at=excluded.scheduled_at,
      scheduled_time_known=excluded.scheduled_time_known,venue=excluded.venue,location_text=excluded.location_text,latitude=excluded.latitude,longitude=excluded.longitude,
      conference_game=excluded.conference_game,status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,selected_source_id=excluded.selected_source_id,
      trust_state=excluded.trust_state,conflict_count=excluded.conflict_count,resolution_json=excluded.resolution_json,last_reconciled_at=excluded.last_reconciled_at,updated_at=excluded.updated_at`)
    .bind(resolved.id,resolved.sport,resolved.gender,resolved.season,resolved.participantA,resolved.participantB,resolved.homeSchoolId,resolved.awaySchoolId,
      resolved.scheduledAt,resolved.scheduledTimeKnown?1:0,resolved.venue||null,venueObservation?.location_text||resolved.venue||null,geoObservation?.latitude??null,geoObservation?.longitude??null,
      conferenceGame,resolved.status,resolved.homeScore??null,resolved.awayScore??null,resolved.selectedSourceId,resolved.trustState,resolved.conflicts.length,
      JSON.stringify(resolved.resolutionEvidence),now,now).run();

  const oldIds=[...new Set(related.map(o=>o.canonical_event_id).filter(id=>id&&id!==resolved.id))];
  for(const candidate of related) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM canonical_event_members WHERE game_id=?").bind(candidate.id),
      env.DB.prepare("UPDATE games SET canonical_event_id=? WHERE id=?").bind(resolved.id,candidate.id),
      env.DB.prepare("INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) VALUES(?,?,?,?,?)")
        .bind(resolved.id,candidate.id,candidate.source_id,candidate.reporting_team_id,now)
    ]);
  }

  await env.DB.prepare("UPDATE event_conflicts SET resolved_at=? WHERE canonical_event_id=? AND resolved_at IS NULL").bind(now,resolved.id).run();
  for(const conflict of resolved.conflicts) {
    await env.DB.prepare("INSERT INTO event_conflicts(canonical_event_id,conflict_type,values_json,evidence_json,detected_at) VALUES(?,?,?,?,?)")
      .bind(resolved.id,conflict.type,JSON.stringify(conflict.values),JSON.stringify({gameIds:related.map(o=>o.id),sourceIds:related.map(o=>o.source_id)}),now).run();
  }
  for(const oldId of oldIds) {
    const member=await env.DB.prepare("SELECT 1 AS yes FROM canonical_event_members WHERE canonical_event_id=? LIMIT 1").bind(oldId).first();
    if(!member) await env.DB.prepare("DELETE FROM canonical_events WHERE id=?").bind(oldId).run();
  }
  return resolved.id;
}
