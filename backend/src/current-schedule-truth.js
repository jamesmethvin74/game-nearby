export const DRAGONFLY_STATEWIDE_REMOVED_NOTE = "Removed from current statewide DragonFly schedule";

export const currentScheduleTruthSql = (gameAlias = "g", sourceAlias = "src") => `NOT (
  ${sourceAlias}.collection_mode='statewide'
  AND ${sourceAlias}.parser_type='dragonfly-public'
  AND instr(COALESCE(${gameAlias}.notes,''),'${DRAGONFLY_STATEWIDE_REMOVED_NOTE}')>0
)`;

export function isRetiredStatewideObservation(game = {}, source = {}) {
  return source.collection_mode === "statewide"
    && source.parser_type === "dragonfly-public"
    && String(game.notes || "").includes(DRAGONFLY_STATEWIDE_REMOVED_NOTE);
}
