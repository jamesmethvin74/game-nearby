export const STATEWIDE_RECORD_REBUILD_SQL = `
  WITH eligible AS (
    SELECT ce.*
    FROM canonical_events ce
    WHERE ce.status='FINAL'
      AND ce.home_score IS NOT NULL
      AND ce.away_score IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM canonical_events prior
        WHERE prior.status='FINAL'
          AND prior.home_score IS NOT NULL
          AND prior.away_score IS NOT NULL
          AND prior.sport=ce.sport
          AND prior.gender=ce.gender
          AND prior.season=ce.season
          AND prior.participant_a_school_id=ce.participant_a_school_id
          AND prior.participant_b_school_id=ce.participant_b_school_id
          AND ABS(strftime('%s',prior.scheduled_at)-strftime('%s',ce.scheduled_at))<=900
          AND (
            CASE prior.trust_state
              WHEN 'CORROBORATED' THEN 4
              WHEN 'AUTHORITATIVE_LIVE' THEN 3
              WHEN 'CONFLICT' THEN 2
              WHEN 'SINGLE_SOURCE_LIVE' THEN 1
              ELSE 0
            END
            >
            CASE ce.trust_state
              WHEN 'CORROBORATED' THEN 4
              WHEN 'AUTHORITATIVE_LIVE' THEN 3
              WHEN 'CONFLICT' THEN 2
              WHEN 'SINGLE_SOURCE_LIVE' THEN 1
              ELSE 0
            END
            OR (
              CASE prior.trust_state
                WHEN 'CORROBORATED' THEN 4
                WHEN 'AUTHORITATIVE_LIVE' THEN 3
                WHEN 'CONFLICT' THEN 2
                WHEN 'SINGLE_SOURCE_LIVE' THEN 1
                ELSE 0
              END
              =
              CASE ce.trust_state
                WHEN 'CORROBORATED' THEN 4
                WHEN 'AUTHORITATIVE_LIVE' THEN 3
                WHEN 'CONFLICT' THEN 2
                WHEN 'SINGLE_SOURCE_LIVE' THEN 1
                ELSE 0
              END
              AND prior.id<ce.id
            )
          )
      )
  )
  INSERT INTO team_records(team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at)
  SELECT t.id,
    SUM(CASE WHEN ce.id IS NOT NULL AND ((ce.home_school_id=t.school_id AND ce.home_score>ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score>ce.home_score)) THEN 1 ELSE 0 END),
    SUM(CASE WHEN ce.id IS NOT NULL AND ((ce.home_school_id=t.school_id AND ce.home_score<ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score<ce.home_score)) THEN 1 ELSE 0 END),
    SUM(CASE WHEN ce.id IS NOT NULL AND ce.home_score=ce.away_score AND (ce.home_school_id=t.school_id OR ce.away_school_id=t.school_id) THEN 1 ELSE 0 END),
    SUM(CASE WHEN ce.id IS NOT NULL AND ce.conference_game=1 AND ((ce.home_school_id=t.school_id AND ce.home_score>ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score>ce.home_score)) THEN 1 ELSE 0 END),
    SUM(CASE WHEN ce.id IS NOT NULL AND ce.conference_game=1 AND ((ce.home_school_id=t.school_id AND ce.home_score<ce.away_score) OR (ce.away_school_id=t.school_id AND ce.away_score<ce.home_score)) THEN 1 ELSE 0 END),
    SUM(CASE WHEN ce.id IS NOT NULL AND ce.conference_game=1 AND ce.home_score=ce.away_score AND (ce.home_school_id=t.school_id OR ce.away_school_id=t.school_id) THEN 1 ELSE 0 END),?
  FROM teams t
  JOIN sources src ON src.team_id=t.id AND src.collection_mode='statewide'
  LEFT JOIN eligible ce ON ce.sport=t.sport AND ce.gender=t.gender AND ce.season=t.season
    AND (ce.home_school_id=t.school_id OR ce.away_school_id=t.school_id)
  GROUP BY t.id
  ON CONFLICT(team_id) DO UPDATE SET
    wins=excluded.wins,losses=excluded.losses,ties=excluded.ties,
    conference_wins=excluded.conference_wins,conference_losses=excluded.conference_losses,
    conference_ties=excluded.conference_ties,calculated_at=excluded.calculated_at`;

export async function rebuildStatewideRecords(env, calculatedAt = new Date().toISOString()) {
  await env.DB.prepare(STATEWIDE_RECORD_REBUILD_SQL).bind(calculatedAt).run();
}
