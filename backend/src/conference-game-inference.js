function opponentSchoolId(row, reportingSchoolId = null) {
  const schoolId = row.school_id || row.reporting_school_id || reportingSchoolId || null;
  if (row.canonical_event_id && schoolId) {
    if (row.canonical_home_school_id === schoolId) return row.canonical_away_school_id || null;
    if (row.canonical_away_school_id === schoolId) return row.canonical_home_school_id || null;
  }
  return row.opponent_school_id || null;
}

function membershipKey(schoolId, sport, gender, season, conferenceId) {
  if (!schoolId || !sport || !gender || !season || !conferenceId) return null;
  return [schoolId, sport, gender, season, conferenceId].map(value => String(value)).join("\u001f");
}

function explicitConferenceGame(row) {
  return Number(row.canonical_conference_game ?? row.conference_game ?? 0) === 1;
}

export async function attachEffectiveConferenceGames(env, rows = [], { reportingSchoolId = null } = {}) {
  if (!rows.length) return rows;

  const opponentIds = [...new Set(rows
    .filter(row => !explicitConferenceGame(row) && row.conference_id)
    .map(row => opponentSchoolId(row, reportingSchoolId))
    .filter(Boolean))];

  let memberships = new Set();
  if (opponentIds.length) {
    const placeholders = opponentIds.map(() => "?").join(",");
    const { results = [] } = await env.DB.prepare(`
      SELECT school_id,sport,gender,season,conference_id
      FROM teams
      WHERE active=1
        AND conference_id IS NOT NULL
        AND school_id IN (${placeholders})
    `).bind(...opponentIds).all();

    memberships = new Set(results
      .map(row => membershipKey(row.school_id, row.sport, row.gender, row.season, row.conference_id))
      .filter(Boolean));
  }

  return rows.map(row => {
    if (explicitConferenceGame(row)) return { ...row, effective_conference_game: 1 };
    const opponentId = opponentSchoolId(row, reportingSchoolId);
    const key = membershipKey(opponentId, row.sport, row.gender, row.season, row.conference_id);
    return { ...row, effective_conference_game: key && memberships.has(key) ? 1 : 0 };
  });
}

export { membershipKey, opponentSchoolId };
