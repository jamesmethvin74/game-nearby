export const DRAGONFLY_STATEWIDE_REMOVED_NOTE = "Removed from current statewide DragonFly schedule";
export const PRESENTATION_SUPPRESSED_NOTE = "Excluded from current LocalBleachers presentation";
export const RESULT_ONLY_SOURCE_SUFFIX = "-official-school-results";

export function isResultOnlyObservationSource(source = {}) {
  const sourceId = String(source.source_id || source.id || "").trim().toLowerCase();
  return sourceId.endsWith(RESULT_ONLY_SOURCE_SUFFIX);
}

export const resultOnlyObservationSql = (sourceAlias = "src") =>
  `LOWER(COALESCE(${sourceAlias}.id,'')) LIKE '%${RESULT_ONLY_SOURCE_SUFFIX}'`;

export const resultOnlySourceSql = (sourceAlias = "src") =>
  `LOWER(COALESCE(${sourceAlias}.id,'')) NOT LIKE '%${RESULT_ONLY_SOURCE_SUFFIX}'`;

export const currentObservationEvidenceSql = (gameAlias = "g", sourceAlias = "src") => `(
  NOT (
  (
    ${sourceAlias}.collection_mode='statewide'
    AND ${sourceAlias}.parser_type='dragonfly-public'
    AND instr(COALESCE(${gameAlias}.notes,''),'${DRAGONFLY_STATEWIDE_REMOVED_NOTE}')>0
  )
  OR instr(COALESCE(${gameAlias}.notes,''),'${PRESENTATION_SUPPRESSED_NOTE}')>0
  )
)`;

export const currentCanonicalObservationEvidenceSql = (gameAlias = "g", sourceAlias = "src", canonicalAlias = "ce") => `(
  NOT (
    ${sourceAlias}.collection_mode='statewide'
    AND ${sourceAlias}.parser_type='dragonfly-public'
    AND instr(COALESCE(${gameAlias}.notes,''),'${DRAGONFLY_STATEWIDE_REMOVED_NOTE}')>0
  )
  AND (
    instr(COALESCE(${gameAlias}.notes,''),'${PRESENTATION_SUPPRESSED_NOTE}')=0
    OR (
      UPPER(COALESCE(${canonicalAlias}.status,''))='FINAL'
      AND ${canonicalAlias}.home_score IS NOT NULL
      AND ${canonicalAlias}.away_score IS NOT NULL
    )
  )
)`;

export const currentScheduleTruthSql = (gameAlias = "g", sourceAlias = "src") => `(
  ${resultOnlySourceSql(sourceAlias)}
  AND ${currentObservationEvidenceSql(gameAlias, sourceAlias)}
)`;

export function hasRetiredStatewideMarker(game = {}) {
  return String(game.notes || "").includes(DRAGONFLY_STATEWIDE_REMOVED_NOTE);
}

export function hasPresentationSuppressedMarker(game = {}) {
  return String(game.notes || "").includes(PRESENTATION_SUPPRESSED_NOTE);
}

export function isRetiredStatewideObservation(game = {}, source = {}) {
  return source.collection_mode === "statewide"
    && source.parser_type === "dragonfly-public"
    && hasRetiredStatewideMarker(game);
}

export function isPresentationSuppressedObservation(game = {}, source = {}) {
  return hasPresentationSuppressedMarker(game) || isRetiredStatewideObservation(game, source);
}


export function suppressionPreservingNotesSql(existingAlias="games", incomingAlias="excluded") {
  return `CASE
    WHEN instr(COALESCE(${existingAlias}.notes,''),'${PRESENTATION_SUPPRESSED_NOTE}')>0
      AND UPPER(COALESCE(${incomingAlias}.status,'SCHEDULED'))='SCHEDULED'
      AND datetime(${incomingAlias}.scheduled_at)<=datetime('now','-6 hours')
    THEN ${existingAlias}.notes
    ELSE ${incomingAlias}.notes
  END`;
}
