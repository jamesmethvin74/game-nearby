function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(wins = 0, losses = 0, ties = 0) {
  const w = numeric(wins);
  const l = numeric(losses);
  const t = numeric(ties);
  const games = w + l + t;
  return games ? (w + 0.5 * t) / games : 0;
}

function pctText(wins = 0, losses = 0, ties = 0) {
  return pct(wins, losses, ties).toFixed(3).replace(/^0/, "");
}

function recordText(wins = 0, losses = 0, ties = 0) {
  const w = numeric(wins);
  const l = numeric(losses);
  const t = numeric(ties);
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function recordGames(value = "") {
  const parts = String(value).match(/\d+/g)?.map(Number) || [];
  return parts.reduce((sum, part) => sum + part, 0);
}

function recordParts(value = "") {
  const parts = String(value).match(/\d+/g)?.map(Number) || [];
  return {
    wins: numeric(parts[0]),
    losses: numeric(parts[1]),
    ties: numeric(parts[2])
  };
}

function schoolKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\b(?:senior|sr\.?)[\s-]+high[\s-]+school\b/g, " ")
    .replace(/\bhigh[\s-]+school\b/g, " ")
    .replace(/\bhs\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function rankCombinedRows(rows = []) {
  const ranked = rows.map((row, originalIndex) => {
    const conference = recordParts(row.conference_record);
    return { ...row, __conference: conference, __originalIndex: originalIndex };
  });

  ranked.sort((a, b) =>
    pct(b.__conference.wins, b.__conference.losses, b.__conference.ties)
      - pct(a.__conference.wins, a.__conference.losses, a.__conference.ties)
    || b.__conference.wins - a.__conference.wins
    || a.__conference.losses - b.__conference.losses
    || a.__conference.ties - b.__conference.ties
    || a.__originalIndex - b.__originalIndex
    || String(a.school_name || "").localeCompare(String(b.school_name || ""))
  );

  let previousRecord = null;
  let previousRank = 0;
  return ranked.map((row, index) => {
    const conferenceKey = `${row.__conference.wins}-${row.__conference.losses}-${row.__conference.ties}`;
    const rank = conferenceKey === previousRecord ? previousRank : index + 1;
    previousRecord = conferenceKey;
    previousRank = rank;
    const overall = recordParts(row.overall_record);
    const { __conference, __originalIndex, ...clean } = row;
    return {
      ...clean,
      rank,
      conference_pct: pctText(__conference.wins, __conference.losses, __conference.ties),
      overall_pct: pctText(overall.wins, overall.losses, overall.ties)
    };
  });
}

export function overlayCalculatedStandings(published, calculated) {
  const publishedRows = Array.isArray(published?.standings) ? published.standings : [];
  const calculatedRows = Array.isArray(calculated?.standings) ? calculated.standings : [];
  if (!calculatedRows.length) return published;
  if (!publishedRows.length) return calculated;

  const calculatedBySchool = new Map();
  for (const row of calculatedRows) {
    const key = schoolKey(row.school_name);
    if (key) calculatedBySchool.set(key, row);
  }

  const matched = new Set();
  const merged = publishedRows.map(row => {
    const key = schoolKey(row.school_name);
    const local = calculatedBySchool.get(key);
    if (!local) return { ...row };
    matched.add(key);
    return {
      ...row,
      team_id: local.team_id || row.team_id,
      conference_record: local.conference_record || row.conference_record || "0-0",
      overall_record: local.overall_record || row.overall_record || "0-0",
      method: "calculated",
      calculated_at: local.calculated_at || null,
      canonical_overlay: true
    };
  });

  for (const local of calculatedRows) {
    const key = schoolKey(local.school_name);
    if (!key || matched.has(key)) continue;
    merged.push({
      ...local,
      method: "calculated",
      canonical_overlay: true
    });
  }

  return {
    ...published,
    conference: {
      ...(published?.conference || {}),
      standings_method: "calculated",
      canonical_overlay: true,
      local_coverage_complete: Boolean(calculated?.conference?.coverage_complete)
    },
    standings: rankCombinedRows(merged)
  };
}

export function buildCalculatedStandings(rows = []) {
  const sorted = rows.map(row => ({
    ...row,
    wins: numeric(row.wins),
    losses: numeric(row.losses),
    ties: numeric(row.ties),
    conference_wins: numeric(row.conference_wins ?? row.cw),
    conference_losses: numeric(row.conference_losses ?? row.cl),
    conference_ties: numeric(row.conference_ties ?? row.ct)
  }));

  sorted.sort((a, b) =>
    pct(b.conference_wins, b.conference_losses, b.conference_ties)
      - pct(a.conference_wins, a.conference_losses, a.conference_ties)
    || b.conference_wins - a.conference_wins
    || String(a.school_name || "").localeCompare(String(b.school_name || ""))
  );

  return sorted.map((row, index) => ({
    rank: index + 1,
    team_id: row.team_id,
    school_name: row.school_name,
    conference_record: recordText(row.conference_wins, row.conference_losses, row.conference_ties),
    overall_record: recordText(row.wins, row.losses, row.ties),
    conference_pct: pctText(row.conference_wins, row.conference_losses, row.conference_ties),
    overall_pct: pctText(row.wins, row.losses, row.ties),
    method: "calculated"
  }));
}

async function touchedCohorts(env, teamIds) {
  const ids = [...new Set((teamIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const result = await env.DB.prepare(`
    SELECT DISTINCT t.conference_id,t.sport,t.gender,t.season,
      c.standings_method,c.coverage_complete
    FROM teams t
    JOIN conferences c ON c.id=t.conference_id
    WHERE t.id IN (SELECT value FROM json_each(?))
      AND t.active=1
      AND t.conference_id IS NOT NULL
  `).bind(JSON.stringify(ids)).all();
  return result.results || [];
}

async function cohortRows(env, cohort) {
  const result = await env.DB.prepare(`
    SELECT t.id AS team_id,s.name AS school_name,
      COALESCE(r.wins,0) AS wins,COALESCE(r.losses,0) AS losses,COALESCE(r.ties,0) AS ties,
      COALESCE(r.conference_wins,0) AS conference_wins,
      COALESCE(r.conference_losses,0) AS conference_losses,
      COALESCE(r.conference_ties,0) AS conference_ties
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN team_records r ON r.team_id=t.id
    WHERE t.active=1
      AND t.conference_id=?
      AND t.sport=?
      AND t.gender=?
      AND t.season=?
      AND s.catalog_scope='local'
    ORDER BY s.name,t.id
  `).bind(cohort.conference_id, cohort.sport, cohort.gender, cohort.season).all();
  return result.results || [];
}

async function persistCalculatedStandings(env, cohort, standings, calculatedAt) {
  const statements = standings.map(row => env.DB.prepare(`
    INSERT INTO standings(conference_id,team_id,rank,conference_record,overall_record,method,source_url,calculated_at)
    VALUES(?,?,?,?,?,'calculated',NULL,?)
    ON CONFLICT(conference_id,team_id) DO UPDATE SET
      rank=excluded.rank,
      conference_record=excluded.conference_record,
      overall_record=excluded.overall_record,
      method='calculated',
      source_url=NULL,
      calculated_at=excluded.calculated_at
    WHERE standings.rank IS NOT excluded.rank
       OR standings.conference_record IS NOT excluded.conference_record
       OR standings.overall_record IS NOT excluded.overall_record
       OR standings.method<>'calculated'
       OR standings.source_url IS NOT NULL
  `).bind(
    cohort.conference_id,
    row.team_id,
    row.rank,
    row.conference_record,
    row.overall_record,
    calculatedAt
  ));

  const chunkSize = 50;
  for (let index = 0; index < statements.length; index += chunkSize) {
    await env.DB.batch(statements.slice(index, index + chunkSize));
  }
}

export async function rebuildStandingsForTeams(
  env,
  teamIds,
  calculatedAt = new Date().toISOString(),
  { skipCompleteCalculated = false } = {}
) {
  const cohorts = await touchedCohorts(env, teamIds);
  let rebuiltCohorts = 0;
  let standingsRows = 0;
  for (const cohort of cohorts) {
    if (skipCompleteCalculated
      && cohort.standings_method === "calculated"
      && Number(cohort.coverage_complete || 0) === 1) {
      continue;
    }
    const rows = await cohortRows(env, cohort);
    const standings = buildCalculatedStandings(rows);
    await persistCalculatedStandings(env, cohort, standings, calculatedAt);
    rebuiltCohorts += 1;
    standingsRows += standings.length;
  }
  return { cohorts: rebuiltCohorts, standingsRows };
}

export async function loadMaterializedCalculatedStandings(env, {
  conferenceId,
  sport,
  season = "2026"
} = {}) {
  if (!conferenceId || !sport) return null;
  const conference = await env.DB.prepare(`
    SELECT id,name,classification,source_url,standings_method,coverage_complete
    FROM conferences
    WHERE id=?
  `).bind(conferenceId).first();
  if (!conference) return null;

  const result = await env.DB.prepare(`
    SELECT st.rank,st.team_id,st.conference_record,st.overall_record,st.calculated_at,
      s.name AS school_name
    FROM standings st
    JOIN teams t ON t.id=st.team_id
    JOIN schools s ON s.id=t.school_id
    WHERE st.conference_id=?
      AND st.method='calculated'
      AND t.active=1
      AND t.sport=?
      AND t.season=?
      AND s.catalog_scope='local'
    ORDER BY st.rank IS NULL,st.rank,s.name
  `).bind(conferenceId, sport, season).all();
  const rows = result.results || [];
  if (!rows.length || !rows.some(row => recordGames(row.overall_record) > 0)) return null;

  return {
    conference: {
      id: conference.id,
      name: conference.name,
      sport,
      standings_method: "calculated",
      coverage_complete: Number(conference.coverage_complete || 0) === 1,
      source_url: null
    },
    standings: rows.map((row, index) => {
      const conferenceParts = String(row.conference_record || "0-0").match(/\d+/g)?.map(Number) || [];
      const overallParts = String(row.overall_record || "0-0").match(/\d+/g)?.map(Number) || [];
      return {
        rank: row.rank ?? index + 1,
        team_id: row.team_id,
        school_name: row.school_name,
        conference_record: row.conference_record || "0-0",
        overall_record: row.overall_record || "0-0",
        conference_pct: pctText(conferenceParts[0], conferenceParts[1], conferenceParts[2]),
        overall_pct: pctText(overallParts[0], overallParts[1], overallParts[2]),
        method: "calculated",
        calculated_at: row.calculated_at || null
      };
    })
  };
}

export { pct, pctText, recordText };
