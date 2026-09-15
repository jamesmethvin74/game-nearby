const RESULT_SOURCE_QUARANTINES = Object.freeze([
  Object.freeze({
    provider:"maxpreps",
    native_event_id:"68e6ca03-cd54-40c8-9bff-4abd5d8871f6",
    reason:"MaxPreps statewide scoreboard reports a 1-1 final while the provider matchup page reports that no result has been reported.",
    evidence_url:"https://www.maxpreps.com/ar/volleyball/match/batesville-vs-brookland/8-29-2026/?c=68e6ca03-cd54-40c8-9bff-4abd5d8871f6"
  })
]);

function text(value) { return String(value ?? "").trim().toLowerCase(); }

function rowIdentifiers(row={}) {
  const values=[
    row.source_event_key,
    row.sourceEventKey,
    row.canonical_event_id,
    row.canonicalEventId,
    row.source_url,
    row.sourceUrl
  ].map(text).filter(Boolean);
  return values;
}

export function resultSourceQuarantine(row={}) {
  const identifiers=rowIdentifiers(row);
  if (!identifiers.length) return null;
  return RESULT_SOURCE_QUARANTINES.find(entry=>{
    const id=text(entry.native_event_id);
    return identifiers.some(value=>
      value===`native:${id}`
      || value.includes(`mp-${id}`)
      || value.includes(`c=${id}`)
      || value===id
    );
  }) || null;
}

export function isResultSourceQuarantined(row={}) {
  return Boolean(resultSourceQuarantine(row));
}

export { RESULT_SOURCE_QUARANTINES };
