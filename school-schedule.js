(() => {
  const live = window.LocalBleachersLive;
  if (!live?.fetchTeamSchedule) return;

  const API_BASE = String(window.LocalBleachersTeamsCatalog?.apiBase || live.apiBase || "").replace(/\/$/, "");
  const memoryCache = new Map();
  const SCHEDULE_CACHE_PREFIX = "localBleachersAR:teamSchedule:v1:";
  const SCHEDULE_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const NEARBY_CACHE_KEY = "localBleachersAR:nearbyGames:v1";
  const NEARBY_CACHE_MAX_AGE_MS = 18 * 60 * 60 * 1000;
  const MAX_TEAM_ENDPOINTS_PER_OPEN = 3;

  function currentSeason() {
    return String(new Date().getFullYear());
  }

  function schoolFor(id) {
    return (typeof SCHOOL_REGISTRY !== "undefined" ? SCHOOL_REGISTRY : []).find(school => school.id === id)
      || { id, name: id, level: "high-school", teamCount: 1 };
  }

  function cloneEvents(events) {
    return (events || []).map(event => ({
      ...event,
      schoolIds: Array.isArray(event.schoolIds) ? [...event.schoolIds] : []
    }));
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (error) {
      console.warn("Schedule cache read failed", key, error);
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("Schedule cache write failed", key, error);
      return false;
    }
  }

  function scheduleCacheKey(schoolId) {
    return `${SCHEDULE_CACHE_PREFIX}${schoolId}`;
  }

  function restoreSavedSchedule(schoolId) {
    const saved = readJson(scheduleCacheKey(schoolId));
    if (!saved || !Array.isArray(saved.events) || !saved.events.length) return [];
    const savedAt = Number(saved.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > SCHEDULE_CACHE_MAX_AGE_MS) return [];
    return cloneEvents(saved.events);
  }

  function saveSchedule(schoolId, events) {
    if (!Array.isArray(events) || !events.length) return;
    writeJson(scheduleCacheKey(schoolId), { savedAt: Date.now(), events: cloneEvents(events) });
  }

  function nearbyFallback(schoolId) {
    const saved = readJson(NEARBY_CACHE_KEY);
    if (!saved || !Array.isArray(saved.events) || !saved.events.length) return [];
    const savedAt = Number(saved.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > NEARBY_CACHE_MAX_AGE_MS) return [];
    return cloneEvents(saved.events)
      .filter(event => event.teamId === schoolId || (event.schoolIds || []).includes(schoolId))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  function fallbackEvents(schoolId) {
    const savedSchedule = restoreSavedSchedule(schoolId);
    if (savedSchedule.length) return savedSchedule;
    return nearbyFallback(schoolId);
  }

  function candidatesFor(school) {
    const season = currentSeason();
    const college = school.level === "college";
    const candidates = college
      ? [
          { id:`${school.id}-football-${season}`, sport:"football", gender:"men" },
          { id:`${school.id}-volleyball-${season}`, sport:"volleyball", gender:"women" },
          { id:`${school.id}-mens-soccer-${season}`, sport:"soccer", gender:"men" },
          { id:`${school.id}-womens-soccer-${season}`, sport:"soccer", gender:"women" },
          { id:`${school.id}-mens-basketball-${season}`, sport:"basketball", gender:"men" },
          { id:`${school.id}-womens-basketball-${season}`, sport:"basketball", gender:"women" }
        ]
      : [
          // Volleyball is the broadest current statewide dataset, so try it first.
          { id:`${school.id}-volleyball-${season}`, sport:"volleyball", gender:"girls" },
          { id:`${school.id}-football-${season}`, sport:"football", gender:"boys" },
          { id:`${school.id}-girls-soccer-${season}`, sport:"soccer", gender:"girls" },
          { id:`${school.id}-boys-soccer-${season}`, sport:"soccer", gender:"boys" },
          { id:`${school.id}-girls-basketball-${season}`, sport:"basketball", gender:"girls" },
          { id:`${school.id}-boys-basketball-${season}`, sport:"basketball", gender:"boys" }
        ];
    return candidates;
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
      const games = (Array.isArray(payload?.games) ? payload.games : [])
        .filter(game => game && (game.scheduled_at || game.canonical_scheduled_at))
        .map(game => mapGame(game, school, candidate, record));
      return { found: true, games };
    } catch (error) {
      if (error?.status === 404) return { found: false, games: [] };
      throw error;
    }
  }

  live.fetchTeamSchedule = async schoolId => {
    if (memoryCache.has(schoolId)) return cloneEvents(memoryCache.get(schoolId));

    const school = schoolFor(schoolId);
    const restored = restoreSavedSchedule(schoolId);
    if (restored.length) memoryCache.set(schoolId, restored);

    const reportedTeamCount = Math.max(1, Number(school.teamCount || 1));
    const targetTeamCount = Math.min(MAX_TEAM_ENDPOINTS_PER_OPEN, reportedTeamCount);
    const games = [];
    let foundTeams = 0;
    let lastError = null;

    for (const candidate of candidatesFor(school).slice(0, MAX_TEAM_ENDPOINTS_PER_OPEN)) {
      try {
        const result = await fetchCandidate(school, candidate);
        if (!result.found) continue;
        foundTeams += 1;
        games.push(...result.games);
        if (foundTeams >= targetTeamCount) break;
      } catch (error) {
        // A 500/429/quota failure is not a reason to fan out into more D1 calls.
        lastError = error;
        console.warn("School schedule API stopped after server failure", schoolId, error);
        break;
      }
    }

    const unique = [...new Map(games.map(game => [`${game.sport}|${game.gender}|${game.backendCanonicalEventId || game.backendGameId}`, game])).values()]
      .sort((a,b) => new Date(a.date) - new Date(b.date));

    if (unique.length) {
      memoryCache.set(schoolId, unique);
      saveSchedule(schoolId, unique);
      return cloneEvents(unique);
    }

    const fallback = restored.length ? restored : fallbackEvents(schoolId);
    if (fallback.length) {
      memoryCache.set(schoolId, fallback);
      return cloneEvents(fallback);
    }

    if (lastError) throw lastError;
    return [];
  };
})();
