export const DRAGONFLY_STATEWIDE_REMOVED_NOTE = "Removed from current statewide DragonFly schedule";
export const PRESENTATION_SUPPRESSED_NOTE = "Excluded from current LocalBleachers presentation";

export const currentScheduleTruthSql = (gameAlias = "g", sourceAlias = "src") => `NOT (
  (
    ${sourceAlias}.collection_mode='statewide'
    AND ${sourceAlias}.parser_type='dragonfly-public'
    AND instr(COALESCE(${gameAlias}.notes,''),'${DRAGONFLY_STATEWIDE_REMOVED_NOTE}')>0
  )
  OR instr(COALESCE(${gameAlias}.notes,''),'${PRESENTATION_SUPPRESSED_NOTE}')>0
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
