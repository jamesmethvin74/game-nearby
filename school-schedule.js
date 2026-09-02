(() => {
  const live = window.LocalBleachersLive;
  if (!live?.fetchTeamSchedule) return;

  const API_BASE = String(window.LocalBleachersTeamsCatalog?.apiBase || live.apiBase || "").replace(/\/$/, "");
  const legacyFetch = live.fetchTeamSchedule.bind(live);
  const cache = new Map();

  function currentSeason() {
    const now = new Date();
    return String(now.getFullYear());
  }

  function schoolFor(id) {
    return (typeof SCHOOL_REGISTRY !== "undefined" ? SCHOOL_REGISTRY : []).find(school => school.id === id)
      || { id, name: id, level: "high-school" };
  }

  function candidatesFor(school) {
    const season = currentSeason();
    const college = school.level === "college";
    const candidates = [
      { id:`${school.id}-football-${season}`, sport:"football", gender:college ? "men" : "boys" },
      { id:`${school.id}-volleyball-${season}`, sport:"volleyball", gender:college ? "women" : "girls" },
      { id:`${school.id}-mens-soccer-${season}`, sport:"soccer", gender:"men" },
      { id:`${school.id}-womens-soccer-${season}`, sport:"soccer", gender:"women" },
      { id:`${school.id}-boys-soccer-${season}`, sport:"soccer", gender:"boys" },
      { id:`${school.id}-girls-soccer-${season}`, sport:"soccer", gender:"girls" },
      { id:`${school.id}-mens-basketball-${season}`, sport:"basketball", gender:"men" },
      { id:`${school.id}-womens-basketball-${season}`, sport:"basketball", gender:"women" },
      { id:`${school.id}-boys-basketball-${season}`, sport:"basketball", gender:"boys" },
      { id:`${school.id}-girls-basketball-${season}`, sport:"basketball", gender:"girls" }
    ];
    return candidates.filter(candidate => college ? !["boys","girls"].includes(candidate.gender) : !["men","women"].includes(candidate.gender));
  }

  async function fetchJson(path) {
    const response = await fetch(`${API_BASE}${path}`, { headers:{accept:"application/json"}, cache:"no-store" });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function numericRecord(record) {
    if (!record) return null;
    const number = key => Number(record[key] || 0);
    return {
      wins:number("wins"), losses:number("losses"), ties:number("ties"),
      conference_wins:number("conference_wins"), conference_losses:number("conference_losses"), conference_ties:number("conference_ties"),
      conference_id:record.conference_id || null,
      conference_name:record.conference_name || null,
      rank:record.rank == null ? null : Number(record.rank),
      calculated_at:record.calculated_at || null
    };
  }

  function mapGame(game, school, candidate, record) {
    const canonicalId = game.canonical_event_id || game.id;
    return {
      id:`live:${canonicalId}`,
      backendGameId:game.id,
      backendCanonicalEventId:game.canonical_event_id || null,
      canonicalHomeSchoolId:game.canonical_home_school_id || null,
      canonicalAwaySchoolId:game.canonical_away_school_id || null,
      canonicalHomeName:game.canonical_home_name || "",
      canonicalAwayName:game.canonical_away_name || "",
      liveData:true,
      dataTrust:game.data_trust || "SINGLE_SOURCE_LIVE",
      sourceConflictCount:Number(game.conflict_count || 0),
      scheduleObservationCount:Number(game.schedule_observation_count || 1),
      sourceType:game.source_type || "",
      parserType:game.parser_type || "",
      record,
      conferenceName:record?.conference_name || game.conference_name || null,
      teamId:school.id,
      schoolIds:[...new Set([school.id, game.canonical_home_school_id, game.canonical_away_school_id].filter(Boolean))],
      team:school.name,
      sport:candidate.sport,
      gender:candidate.gender,
      level:school.level || "high-school",
      opponent:game.opponent || "Opponent TBA",
      date:game.scheduled_at || game.canonical_scheduled_at,
      home:game.home_away === "home",
      lat:game.latitude == null ? NaN : Number(game.latitude),
      lon:game.longitude == null ? NaN : Number(game.longitude),
      venue:game.venue || game.canonical_venue || "Venue TBA",
      source:"live",
      sourceLabel:game.source_type === "official-school" || game.source_type === "official-athletics" ? "School athletics schedule" : "Live schedule",
      sourceUrl:game.source_url || API_BASE,
      status:game.status || game.canonical_status || "SCHEDULED",
      teamScore:game.team_score,
      opponentScore:game.opponent_score,
      result:game.result,
      conferenceGame:Boolean(game.conference_game),
      notes:game.scheduled_time_known === 0 ? "Time TBA" : "",
      ticketUrl:""
    };
  }

  async function fetchCandidate(school, candidate) {
    try {
      const payload = await fetchJson(`/api/v1/teams/${encodeURIComponent(candidate.id)}/schedule`);
      const record = numericRecord(payload?.record);
      return (Array.isArray(payload?.games) ? payload.games : [])
        .filter(game => game && (game.scheduled_at || game.canonical_scheduled_at))
        .map(game => mapGame(game, school, candidate, record));
    } catch (error) {
      if (error?.status === 404) return [];
      throw error;
    }
  }

  live.fetchTeamSchedule = async schoolId => {
    if (cache.has(schoolId)) return cache.get(schoolId).map(event => ({...event}));
    const school = schoolFor(schoolId);
    try {
      const results = await Promise.allSettled(candidatesFor(school).map(candidate => fetchCandidate(school, candidate)));
      const games = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
      const unique = [...new Map(games.map(game => [`${game.sport}|${game.gender}|${game.backendCanonicalEventId || game.backendGameId}`, game])).values()]
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      if (unique.length) {
        cache.set(schoolId, unique);
        return unique.map(event => ({...event}));
      }
    } catch (error) {
      console.warn("School-wide schedule aggregation failed", error);
    }
    return legacyFetch(schoolId);
  };
})();
