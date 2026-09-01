const USER_AGENT = "LocalBleachersAR/2.0 (+https://github.com/jamesmethvin74/game-nearby)";

const SOURCES = new Map([
  ["uca|football|men", {
    schoolId:"uca", sport:"football", gender:"men", conferenceId:"uac", conferenceName:"UAC",
    sourceUrl:"https://ucasports.com/sports/football/schedule/2026"
  }],
  ["uca|volleyball|women", {
    schoolId:"uca", sport:"volleyball", gender:"women", conferenceId:"uac", conferenceName:"UAC",
    sourceUrl:"https://ucasports.com/sports/womens-volleyball/schedule/2026"
  }],
  ["uca|soccer|women", {
    schoolId:"uca", sport:"soccer", gender:"women", conferenceId:"uac", conferenceName:"UAC",
    sourceUrl:"https://ucasports.com/sports/womens-soccer/schedule/2026"
  }],
  ["hendrix|football|men", {
    schoolId:"hendrix", sport:"football", gender:"men", conferenceId:"scac", conferenceName:"SCAC",
    sourceUrl:"https://hendrixwarriors.com/sports/football/schedule/2026"
  }],
  ["hendrix|volleyball|women", {
    schoolId:"hendrix", sport:"volleyball", gender:"women", conferenceId:"scac", conferenceName:"SCAC",
    sourceUrl:"https://hendrixwarriors.com/sports/womens-volleyball/schedule/2026"
  }],
  ["hendrix|soccer|women", {
    schoolId:"hendrix", sport:"soccer", gender:"women", conferenceId:"scac", conferenceName:"SCAC",
    sourceUrl:"https://hendrixwarriors.com/sports/womens-soccer/schedule/2026"
  }]
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function keyFor({ schoolId, sport, gender }) {
  return `${clean(schoolId).toLowerCase()}|${clean(sport).toLowerCase()}|${clean(gender).toLowerCase()}`;
}

export function collegeRecordSource(query) {
  return SOURCES.get(keyFor(query)) || null;
}

export function parseResultOutcome(value) {
  const text = clean(value);
  const match = text.match(/\b([WLT])\s*,?\s*\d+\s*[-–]\s*\d+/i)
    || text.match(/\b([WLT])\b/i);
  return match ? match[1].toUpperCase() : null;
}

export function summarizeCollegeScheduleRows(rows, source) {
  let wins = 0, losses = 0, ties = 0;
  let conferenceWins = 0, conferenceLosses = 0, conferenceTies = 0;
  let finals = 0;

  for (const row of rows || []) {
    const full = clean(row?.full);
    if (/\b(exhibition|scrimmage)\b/i.test(full)) continue;
    const outcome = parseResultOutcome(row?.result);
    if (!outcome) continue;
    finals += 1;
    if (outcome === "W") wins += 1;
    else if (outcome === "L") losses += 1;
    else ties += 1;

    if (clean(row?.conference)) {
      if (outcome === "W") conferenceWins += 1;
      else if (outcome === "L") conferenceLosses += 1;
      else conferenceTies += 1;
    }
  }

  return {
    wins, losses, ties,
    conference_wins: conferenceWins,
    conference_losses: conferenceLosses,
    conference_ties: conferenceTies,
    conference_id: source?.conferenceId || null,
    conference_name: source?.conferenceName || null,
    rank: null,
    calculated_at: new Date().toISOString(),
    finals,
    source_url: source?.sourceUrl || null,
    source_type: "official-athletics"
  };
}

async function parseSidearmRows(html) {
  const state = { current:null, rows:[] };
  const append = field => ({
    text(chunk) {
      if (state.current) state.current[field] = `${state.current[field] || ""}${chunk.text} `;
    }
  });
  const rowHandler = {
    element(el) {
      if (state.current) return;
      state.current = { full:"", result:"", conference:"" };
      state.rows.push(state.current);
      el.onEndTag(() => { state.current = null; });
    },
    text(chunk) {
      if (state.current) state.current.full += `${chunk.text} `;
    }
  };

  const response = new HTMLRewriter()
    .on("li.sidearm-schedule-game, .sidearm-schedule-game-row", rowHandler)
    .on(".sidearm-schedule-game-result", append("result"))
    .on(".sidearm-schedule-game-conference, .sidearm-schedule-game-conference-conference", append("conference"))
    .transform(new Response(html));
  await response.text();
  return state.rows;
}

export async function fetchCollegeRecord(query, { fetchFn = fetch } = {}) {
  const source = collegeRecordSource(query);
  if (!source) return null;

  const response = await fetchFn(source.sourceUrl, {
    headers: {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Official athletics HTTP ${response.status}`);
  const html = await response.text();
  const rows = await parseSidearmRows(html);
  if (!rows.length) throw new Error("Official athletics schedule returned no games");
  return summarizeCollegeScheduleRows(rows, source);
}
