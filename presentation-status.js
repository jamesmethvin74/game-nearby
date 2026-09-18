(() => {
  function gamesInRecord(value) {
    const parts = String(value || "").match(/\d+/g);
    return parts ? parts.map(Number).reduce((sum, part) => sum + part, 0) : 0;
  }
  function teamStatus(status, missing = "—") {
    if (!status) return null;
    const conferenceKnown = Boolean(status.conference_name || status.conference_id)
      || String(status.conference_membership_state || "").toLowerCase() === "member";
    const overall = status.display_overall_record ?? status.overall_record ?? missing;
    const conference = conferenceKnown
      ? (status.display_conference_record ?? status.conference_record ?? (Number(status.conference_games || 0) === 0 ? "0-0" : missing))
      : missing;
    const rank = Number(status.display_rank ?? status.rank);
    return {
      overall,
      conference,
      standing: conferenceKnown && gamesInRecord(conference) > 0 && Number.isFinite(rank) && rank > 0 ? `#${rank}` : missing,
      conferenceName: status.conference_name || (conferenceKnown ? "Conference" : "Conference not available"),
      method: status.display_method || (status.record_verified ? "canonical" : "unavailable"),
      sourceUrl: status.display_source_url || null
    };
  }
  function standingRow(row) {
    if (!row) return null;
    const conference = row.display_conference_record ?? row.conference_record ?? "—";
    const overall = row.display_overall_record ?? row.overall_record ?? "—";
    const rank = Number(row.display_rank ?? row.rank);
    return {
      rank: gamesInRecord(conference) > 0 && Number.isFinite(rank) && rank > 0 ? String(rank) : "—",
      conference,
      overall,
      pct: row.conference_pct == null ? "—" : String(row.conference_pct),
      method: row.display_method || "canonical-unverified"
    };
  }
  window.LocalBleachersPresentation = Object.freeze({contract:"display-v1",gamesInRecord,teamStatus,standingRow});
})();
