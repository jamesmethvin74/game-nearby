const key = (sport, gender) => `${sport}|${gender}`;

// Exact 2026-27 school-host Presto RSS proof from the read-only M3 probe.
// These feeds are official school athletics surfaces and are reachable by a
// normal server-side client even though the centralized NAIA authority is
// Cloudflare-challenged. Only teams with at least one exact 2026-27 item are
// classified as ready. Reachable feeds with no target-season rows stay pending.
export const COLLEGE_PRESTO_RSS_FALLBACKS = Object.freeze({
  cbc: Object.freeze({
    sourceUrl:"https://cbcmustangs.com/composite?print=rss",
    ready:Object.freeze([key("soccer","men"),key("soccer","women"),key("volleyball","women")]),
    pending:Object.freeze([key("basketball","men"),key("basketball","women")])
  }),
  "crowleys-ridge": Object.freeze({
    sourceUrl:"https://www.crcpioneers.com/composite?print=rss",
    ready:Object.freeze([key("basketball","men"),key("volleyball","women")]),
    pending:Object.freeze([key("basketball","women")])
  }),
  "williams-baptist": Object.freeze({
    sourceUrl:"https://www.wbueagles.com/composite?print=rss",
    ready:Object.freeze([key("soccer","men"),key("soccer","women"),key("volleyball","women")]),
    pending:Object.freeze([key("basketball","men"),key("basketball","women")])
  })
});

export function prestoFallbackState(schoolId, sport, gender) {
  const fallback=COLLEGE_PRESTO_RSS_FALLBACKS[schoolId];
  if (!fallback) return null;
  const teamKey=key(sport,gender);
  if (fallback.ready.includes(teamKey)) return {state:"ready",sourceUrl:fallback.sourceUrl};
  if (fallback.pending.includes(teamKey)) return {state:"pending",sourceUrl:fallback.sourceUrl};
  return null;
}

export function prestoFallbackSchoolIds() {
  return Object.keys(COLLEGE_PRESTO_RSS_FALLBACKS);
}
