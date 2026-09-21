import { observationsLikelySameEvent, resolveCanonicalEvent } from "./schedule-authority-core.js";
import { normalizeFinalResultTruth, sanitizeFinalForCanonical } from "./final-result-truth.js";

import { isResultOnlyObservationSource, suppressionPreservingNotesSql } from "./current-schedule-truth.js";
function localDateKey(iso,timeZone="America/Chicago") {
  if (!iso) return "";
  const date=new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}

function nativeObservationIdentity(observation={}) {
  const key=String(observation.source_event_key||observation.sourceEventKey||"").trim().toLowerCase();
  if (!key.startsWith("native:")) return null;
  const parser=String(observation.parser_type||"").trim().toLowerCase();
  if (parser!=="dragonfly-public" && parser!=="maxpreps-scores") return null;
  return {parser,key};
}

function hasSameDayNativeRematch(seed,candidates,timeZone) {
  const date=localDateKey(seed?.scheduled_at,timeZone);
  if (!date) return false;
  const byParser=new Map();
  for (const candidate of candidates||[]) {
    if (localDateKey(candidate?.scheduled_at,timeZone)!==date) continue;
    const native=nativeObservationIdentity(candidate);
    if (!native) continue;
    if (!byParser.has(native.parser)) byParser.set(native.parser,new Set());
    byParser.get(native.parser).add(native.key);
  }
  return [...byParser.values()].some(keys=>keys.size>1);
}

export function relatedObservationsForReconciliation(seed,candidates,{timeZone="America/Chicago"}={}) {
  const rows=Array.isArray(candidates)?candidates:[];
  const singleContestLocalDateSport=String(seed?.sport||"").toLowerCase()==="football";
  const ambiguousSameDayRematch=!singleContestLocalDateSport && hasSameDayNativeRematch(seed,rows,timeZone);
  const seedNative=nativeObservationIdentity(seed);

  // If authoritative native evidence proves the same participants met more than once
  // on the same day, an untimed generic observation cannot safely choose a game.
  if (ambiguousSameDayRematch && !seedNative && !seed?.scheduled_time_known) return [];

  return rows.filter(candidate=>{
    if (candidate.id===seed?.id) return true;
    if (!observationsLikelySameEvent(seed,candidate,{timeZone})) return false;
    if (!ambiguousSameDayRematch) return true;

    const candidateNative=nativeObservationIdentity(candidate);
    if (seedNative && candidateNative && seedNative.parser===candidateNative.parser) {
      return seedNative.key===candidateNative.key;
    }

    // With a same-day rematch, only a real clock on both observations can bridge
    // different source families. An untimed row must remain unattached rather than
    // being guessed onto the wrong tournament match.
    return Boolean(seed?.scheduled_time_known && candidate?.scheduled_time_known);
  });
}

export async function upsertResolvedObservation(env,source,game,checkedAt,{opponentSchoolId}={}) {
  if(!opponentSchoolId) throw new Error("Resolved observation requires opponentSchoolId");
  const normalizedGame=normalizeFinalResultTruth(game);
  const id=`${source.id}:${normalizedGame.sourceEventKey}`;
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
      venue=COALESCE(NULLIF(excluded.venue,''),games.venue),location_text=COALESCE(NULLIF(excluded.location_text,''),games.location_text),
      latitude=COALESCE(excluded.latitude,games.latitude),longitude=COALESCE(excluded.longitude,games.longitude),home_away=excluded.home_away,
      conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,
      status=CASE
        WHEN UPPER(COALESCE(games.status,''))='FINAL'
          AND games.team_score IS NOT NULL
          AND games.opponent_score IS NOT NULL
          AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        THEN games.status
        ELSE excluded.status
      END,
      team_score=CASE
        WHEN UPPER(COALESCE(games.status,''))='FINAL'
          AND games.team_score IS NOT NULL
          AND games.opponent_score IS NOT NULL
          AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        THEN games.team_score
        ELSE excluded.team_score
      END,
      opponent_score=CASE
        WHEN UPPER(COALESCE(games.status,''))='FINAL'
          AND games.team_score IS NOT NULL
          AND games.opponent_score IS NOT NULL
          AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        THEN games.opponent_score
        ELSE excluded.opponent_score
      END,
      result=CASE
        WHEN UPPER(COALESCE(games.status,''))='FINAL'
          AND games.team_score IS NOT NULL
          AND games.opponent_score IS NOT NULL
          AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        THEN games.result
        ELSE excluded.result
      END,
      notes=${suppressionPreservingNotesSql("games","excluded")},
      source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`)
    .bind(id,source.team_id,source.id,normalizedGame.sourceEventKey,normalizedGame.opponent,opponentSchoolId,normalizedGame.scheduledAt,normalizedGame.scheduledTimeKnown?1:0,normalizedGame.venue||null,normalizedGame.locationText||null,
      normalizedGame.latitude??null,normalizedGame.longitude??null,normalizedGame.homeAway,normalizedGame.conferenceGame?1:0,normalizedGame.countsForRecord?1:0,normalizedGame.status,normalizedGame.teamScore??null,normalizedGame.opponentScore??null,
      normalizedGame.result||null,normalizedGame.notes||null,source.source_url,normalizedGame.sourceUpdatedAt||checkedAt,checkedAt,checkedAt).run();
  return id;
}

async function observationById(env,gameId) {
  return env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.id AS reporting_team_id,sch.id AS reporting_school_id,sch.name AS reporting_school_name,
      src.source_type,src.parser_type,src.source_priority,src.authority_rank,src.timezone
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id
    WHERE g.id=?`).bind(gameId).first();
}

export const CANONICAL_EVENT_UPSERT_SQL=`
  INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET
    home_school_id=excluded.home_school_id,away_school_id=excluded.away_school_id,scheduled_at=excluded.scheduled_at,
    scheduled_time_known=excluded.scheduled_time_known,venue=excluded.venue,location_text=excluded.location_text,latitude=excluded.latitude,longitude=excluded.longitude,
    conference_game=excluded.conference_game,
    status=CASE
      WHEN canonical_events.status='FINAL'
        AND canonical_events.home_score IS NOT NULL
        AND canonical_events.away_score IS NOT NULL
        AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        AND canonical_events.home_school_id=excluded.home_school_id
        AND canonical_events.away_school_id=excluded.away_school_id
      THEN canonical_events.status
      ELSE excluded.status
    END,
    home_score=CASE
      WHEN canonical_events.status='FINAL'
        AND canonical_events.home_score IS NOT NULL
        AND canonical_events.away_score IS NOT NULL
        AND canonical_events.home_school_id=excluded.home_school_id
        AND canonical_events.away_school_id=excluded.away_school_id
        AND (
          UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
          OR excluded.home_score IS NULL
          OR excluded.away_score IS NULL
        )
      THEN canonical_events.home_score
      ELSE excluded.home_score
    END,
    away_score=CASE
      WHEN canonical_events.status='FINAL'
        AND canonical_events.home_score IS NOT NULL
        AND canonical_events.away_score IS NOT NULL
        AND canonical_events.home_school_id=excluded.home_school_id
        AND canonical_events.away_school_id=excluded.away_school_id
        AND (
          UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
          OR excluded.home_score IS NULL
          OR excluded.away_score IS NULL
        )
      THEN canonical_events.away_score
      ELSE excluded.away_score
    END,
    selected_source_id=CASE
      WHEN canonical_events.status='FINAL'
        AND canonical_events.home_score IS NOT NULL
        AND canonical_events.away_score IS NOT NULL
        AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        AND canonical_events.home_school_id=excluded.home_school_id
        AND canonical_events.away_school_id=excluded.away_school_id
      THEN canonical_events.selected_source_id
      ELSE excluded.selected_source_id
    END,
    trust_state=CASE
      WHEN canonical_events.status='FINAL'
        AND canonical_events.home_score IS NOT NULL
        AND canonical_events.away_score IS NOT NULL
        AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        AND canonical_events.home_school_id=excluded.home_school_id
        AND canonical_events.away_school_id=excluded.away_school_id
      THEN canonical_events.trust_state
      ELSE excluded.trust_state
    END,
    conflict_count=CASE
      WHEN canonical_events.status='FINAL'
        AND canonical_events.home_score IS NOT NULL
        AND canonical_events.away_score IS NOT NULL
        AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        AND canonical_events.home_school_id=excluded.home_school_id
        AND canonical_events.away_school_id=excluded.away_school_id
      THEN canonical_events.conflict_count
      ELSE excluded.conflict_count
    END,
    resolution_json=CASE
      WHEN canonical_events.status='FINAL'
        AND canonical_events.home_score IS NOT NULL
        AND canonical_events.away_score IS NOT NULL
        AND UPPER(COALESCE(excluded.status,'SCHEDULED'))<>'FINAL'
        AND canonical_events.home_school_id=excluded.home_school_id
        AND canonical_events.away_school_id=excluded.away_school_id
      THEN canonical_events.resolution_json
      ELSE excluded.resolution_json
    END,
    last_reconciled_at=excluded.last_reconciled_at,updated_at=excluded.updated_at`;

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
  const related=relatedObservationsForReconciliation(seed,candidates,{timeZone});
  if(!related.length) return null;

  // Mascot Media and RankOne are result observations only. They can supply
  // a score to an independently scheduled event, but cannot create a varsity
  // schedule event by themselves.
  if (!related.some(observation => !isResultOnlyObservationSource(observation))) return null;

  const canonicalEvidence=related.map(sanitizeFinalForCanonical);
  let resolved;
  try { resolved=resolveCanonicalEvent(canonicalEvidence,{timeZone}); }
  catch { return null; }

  const now=new Date().toISOString();
  const selected=canonicalEvidence.find(o=>o.id===resolved.resolutionEvidence.selectedObservationId)||canonicalEvidence[0];
  const venueObservation=related.find(o=>o.id===resolved.resolutionEvidence.venueObservationId)||related[0];
  const geoObservation=related.find(o=>o.latitude!=null&&o.longitude!=null)||related[0];
  const conferenceGame=Number(selected?.conference_game||0);

  await env.DB.prepare(CANONICAL_EVENT_UPSERT_SQL)
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
