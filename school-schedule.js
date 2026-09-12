(() => {
  const live = window.LocalBleachersLive;
  if (!live?.fetchTeamSchedule) return;

  const API_BASE = String(window.LocalBleachersTeamsCatalog?.apiBase || live.apiBase || "").replace(/\/$/, "");
  const memoryCache = new Map();
  const SCHEDULE_CACHE_PREFIX = "localBleachersAR:teamSchedule:v2:";
  const SCHEDULE_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const NEARBY_CACHE_KEY = "localBleachersAR:nearbyGames:v1";
  const NEARBY_CACHE_MAX_AGE_MS = 18 * 60 * 60 * 1000;

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
    return `${SCHEDULE_CACHE_PREFIX}${currentSeason()}:${schoolId}`;
  }

  function memoryCacheKey(schoolId) {
    return `${currentSeason()}:${schoolId}`;
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
    const fields = ["wins","losses","ties","conference_wins","conference_losses","conference_ties"];
    if (!fields.some(field => record[field] != null)) return null;
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

  function mapGame(game, school) {
    const canonicalId = game.canonical_event_id || game.id;
    const record = numericRecord(game);
    const sport = String(game.sport || "").trim();
    const gender = String(game.gender || "").trim();
    return {
      id:`live:${canonicalId}`,
      backendGameId:game.id,
      backendCanonicalEventId:game.canonical_event_id || null,
      backendTeamId:game.reporting_team_id || game.team_id || null,
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
      sport,
      gender,
      level:school.level || game.level || "high-school",
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

  async function fetchSchoolSchedule(school) {
    const payload = await fetchJson(`/api/v1/schools/${encodeURIComponent(school.id)}/schedule`);
    if (!Array.isArray(payload?.games)) throw new Error("API returned no school schedule");
    return payload.games
      .filter(game => game && (game.scheduled_at || game.canonical_scheduled_at) && game.sport && game.gender)
      .map(game => mapGame(game, school));
  }

  live.fetchTeamSchedule = async schoolId => {
    const cacheKey = memoryCacheKey(schoolId);
    if (memoryCache.has(cacheKey)) return cloneEvents(memoryCache.get(cacheKey));

    const school = schoolFor(schoolId);
    const restored = restoreSavedSchedule(schoolId);
    if (restored.length) memoryCache.set(cacheKey, restored);

    let lastError = null;
    try {
      const games = await fetchSchoolSchedule(school);
      const unique = [...new Map(games.map(game => [
        `${game.backendTeamId || `${game.sport}|${game.gender}`}|${game.backendCanonicalEventId || game.backendGameId}`,
        game
      ])).values()].sort((a,b) => new Date(a.date) - new Date(b.date));

      if (unique.length) {
        memoryCache.set(cacheKey, unique);
        saveSchedule(schoolId, unique);
        return cloneEvents(unique);
      }
    } catch (error) {
      lastError = error;
      console.warn("School schedule API failed", schoolId, error);
    }

    const fallback = restored.length ? restored : fallbackEvents(schoolId);
    if (fallback.length) {
      memoryCache.set(cacheKey, fallback);
      return cloneEvents(fallback);
    }

    if (lastError) throw lastError;
    return [];
  };
})();
