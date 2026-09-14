(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const API_BASE = String(
    window.LOCALBLEACHERS_API_BASE
      || localStorage.getItem("localBleachersAR:apiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");
  const DRAGONFLY_VOLLEYBALL_URL = "https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0";

  const nearbyEvents = [];
  const teamStatuses = new Map();
  const state = {
    apiBase: API_BASE,
    catalogLoadedAt: null,
    nearbyLoadedAt: null,
    catalogCount: 0,
    nearbyCount: 0,
    failures: {},
    nearbyRequest: 0
  };

  async function fetchJson(path, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeSchool(school) {
    const mascot = String(school.mascot || "").trim();
    const city = String(school.city || "").trim();
    const stateCode = String(school.state || "").trim();
    const providerName = String(school.name || "").trim();
    const displayName = String(school.location_matched_name || providerName).trim() || providerName;
    return {
      id: school.id,
      name: displayName,
      providerName,
      subtitle: mascot || [city, stateCode].filter(Boolean).join(", ") || "Arkansas school",
      mascot,
      city,
      state: stateCode,
      level: String(school.level || "high-school"),
      teamCount: Number(school.team_count || 0),
      short: String(displayName || "?").trim().charAt(0).toUpperCase() || "★"
    };
  }

  function applyCatalog(schools) {
    if (!Array.isArray(schools)) return false;
    const normalized = schools
      .filter(school => school && school.id && school.name)
      .map(normalizeSchool)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!normalized.length) return false;

    if (typeof SCHOOL_REGISTRY !== "undefined") {
      SCHOOL_REGISTRY.splice(0, SCHOOL_REGISTRY.length, ...normalized);
    }

    if (typeof teams !== "undefined") {
      for (const school of normalized) {
        const existing = teams.find(team => team.id === school.id);
        if (existing) Object.assign(existing, { name: school.name, short: school.short });
      }
    }

    state.catalogCount = normalized.length;
    state.catalogLoadedAt = new Date().toISOString();
    state.failures.catalog = null;
    if (typeof renderTeamChoices === "function" && typeof dialog !== "undefined" && dialog?.open) renderTeamChoices();
    document.dispatchEvent(new CustomEvent("localbleachers:catalog", { detail: { count: normalized.length } }));
    return true;
  }

  async function refreshCatalog() {
    try {
      const payload = await fetchJson("/api/v1/schools");
      if (!applyCatalog(payload?.schools)) throw new Error("API returned no visible schools");
      return state.catalogCount;
    } catch (error) {
      state.failures.catalog = String(error?.message || error);
      console.warn("Statewide school catalog refresh failed", error);
      return 0;
    }
  }

  function eventSourceUrl(game) {
    if (game.source_url) return game.source_url;
    if (game.parser_type === "dragonfly-public") return DRAGONFLY_VOLLEYBALL_URL;
    return API_BASE;
  }

  function scheduleSourceLabel(game) {
    if (game.parser_type === "dragonfly-public") {
      return game.schedule_confirmed_by_school ? "Arkansas varsity schedule · school confirmed" : "Arkansas varsity schedule";
    }
    if (game.source_type === "official-school" || game.source_type === "official-athletics") return "School athletics schedule";
    return "Live schedule";
  }

  function normalizeRecord(value) {
    if (!value) return null;
    const fields = ["wins","losses","ties","conference_wins","conference_losses","conference_ties"];
    if (!fields.some(field => value[field] != null)) return null;
    const number = field => Number(value[field] || 0);
    return {
      wins:number("wins"),losses:number("losses"),ties:number("ties"),
      conference_wins:number("conference_wins"),conference_losses:number("conference_losses"),conference_ties:number("conference_ties"),
      conference_id:value.conference_id || null,
      conference_name:value.conference_name || null,
      rank:value.rank == null ? null : Number(value.rank),
      calculated_at:value.calculated_at || null
    };
  }

  function statusKey(schoolId, sport, gender = "") {
    return `${String(schoolId || "")}|${String(sport || "")}|${String(gender || "")}`;
  }

  function normalizeTeamStatus(status = {}) {
    return {
      team_id: status.team_id || null,
      school_id: status.school_id || null,
      school_name: status.school_name || null,
      level: status.level || null,
      sport: status.sport || null,
      gender: status.gender || "",
      season: status.season || null,
      conference_id: status.conference_id || null,
      conference_name: status.conference_name || null,
      overall_record: status.record_verified === false ? null : (status.overall_record || null),
      conference_record: status.record_verified === false ? null : (status.conference_record || null),
      overall_games: Number(status.overall_games || 0),
      conference_games: Number(status.conference_games || 0),
      rank: status.rank == null ? null : Number(status.rank),
      standing_state: status.standing_state || null,
      source: status.source || "unverified",
      record_state: status.record_state || null,
      record_audit_state: status.record_audit_state || null,
      record_verified: status.record_verified === true,
      record_issues: Array.isArray(status.record_issues) ? status.record_issues.map(issue => ({ ...issue })) : []
    };
  }

  function applyTeamStatuses(schoolId, statuses) {
    const prefix = `${String(schoolId || "")}|`;
    for (const key of [...teamStatuses.keys()]) {
      if (key.startsWith(prefix)) teamStatuses.delete(key);
    }
    for (const raw of Array.isArray(statuses) ? statuses : []) {
      const status = normalizeTeamStatus(raw);
      if (!status.sport) continue;
      teamStatuses.set(statusKey(schoolId, status.sport, status.gender), status);
    }
  }

  function getTeamStatus(schoolId, sport, gender = "") {
    const exact = teamStatuses.get(statusKey(schoolId, sport, gender));
    if (exact) return { ...exact, record_issues: exact.record_issues.map(issue => ({ ...issue })) };
    const prefix = `${String(schoolId || "")}|${String(sport || "")}|`;
    const fallback = [...teamStatuses.entries()].find(([key]) => key.startsWith(prefix))?.[1] || null;
    return fallback ? { ...fallback, record_issues: fallback.record_issues.map(issue => ({ ...issue })) } : null;
  }

  function mapApiGame(game, school = null, recordOverride = null) {
    const schoolId = school?.id || game.school_id;
    const schoolName = school?.name || game.school_name || "Arkansas school";
    const schoolIds = [...new Set([
      schoolId,
      game.school_id,
      game.canonical_home_school_id,
      game.canonical_away_school_id
    ].filter(Boolean))];
    const date = game.scheduled_at || game.canonical_scheduled_at;
    const record = normalizeRecord(recordOverride || game);
    return {
      id: `live:${game.canonical_event_id || game.id}`,
      backendGameId: game.id,
      backendCanonicalEventId: game.canonical_event_id || null,
      canonicalHomeSchoolId: game.canonical_home_school_id || null,
      canonicalAwaySchoolId: game.canonical_away_school_id || null,
      canonicalHomeName: game.canonical_home_name || "",
      canonicalAwayName: game.canonical_away_name || "",
      liveData: true,
      dataTrust: game.data_trust || "SINGLE_SOURCE_LIVE",
      sourceConflictCount: Number(game.conflict_count || 0),
      scheduleObservationCount: Number(game.schedule_observation_count || 1),
      scheduleConfirmedBySchool: Boolean(game.schedule_confirmed_by_school),
      sourceType: game.source_type || "",
      parserType: game.parser_type || "",
      record,
      conferenceName: record?.conference_name || game.conference_name || null,
      teamId: schoolId,
      schoolIds,
      team: schoolName,
      sport: game.sport || "volleyball",
      gender: game.gender || (school?.level === "college" ? "women" : "girls"),
      level: game.level || school?.level || "high-school",
      opponent: game.opponent || "Opponent TBA",
      date,
      home: game.home_away === "home",
      lat: game.latitude == null ? NaN : Number(game.latitude),
      lon: game.longitude == null ? NaN : Number(game.longitude),
      venue: game.venue || game.canonical_venue || "Venue TBA",
      source: "live",
      sourceLabel: scheduleSourceLabel(game),
      sourceUrl: eventSourceUrl(game),
      status: game.status || "SCHEDULED",
      teamScore: game.team_score,
      opponentScore: game.opponent_score,
      result: game.result,
      conferenceGame: Boolean(game.conference_game),
      notes: game.scheduled_time_known === 0 ? "Time TBA" : "",
      ticketUrl: ""
    };
  }

  function applyNearbyGames(games) {
    if (!Array.isArray(games)) return false;
    const mapped = games
      .filter(game => game && (game.scheduled_at || game.canonical_scheduled_at))
      .map(game => mapApiGame(game))
      .filter(game => Number.isFinite(game.lat) && Number.isFinite(game.lon));

    nearbyEvents.splice(0, nearbyEvents.length, ...mapped);
    state.nearbyCount = mapped.length;
    state.nearbyLoadedAt = new Date().toISOString();
    state.failures.nearby = null;
    if (typeof render === "function") render();
    document.dispatchEvent(new CustomEvent("localbleachers:nearby-games", { detail: { count: mapped.length } }));
    return true;
  }

  async function refreshNearby() {
    if (typeof center === "undefined" || typeof radiusEl === "undefined") return 0;
    const requestId = ++state.nearbyRequest;
    const radius = Math.max(1, Number(radiusEl.value) || 25);
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const until = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      lat: String(center.lat),
      lon: String(center.lon),
      radius: String(radius),
      since,
      until
    });

    try {
      const payload = await fetchJson(`/api/v1/games?${params.toString()}`);
      if (requestId !== state.nearbyRequest) return state.nearbyCount;
      if (!Array.isArray(payload?.games)) throw new Error("API returned no games array");
      applyNearbyGames(payload.games);
      return state.nearbyCount;
    } catch (error) {
      if (requestId !== state.nearbyRequest) return state.nearbyCount;
      state.failures.nearby = String(error?.message || error);
      console.warn("Statewide nearby games refresh failed; keeping last-known nearby data", error);
      return state.nearbyCount;
    }
  }

  async function fetchTeamSchedule(schoolId) {
    const school = (typeof SCHOOL_REGISTRY !== "undefined" ? SCHOOL_REGISTRY : []).find(item => item.id === schoolId)
      || { id: schoolId, name: schoolId, level: "high-school" };
    const payload = await fetchJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/schedule`, 15000);
    if (!Array.isArray(payload?.games)) throw new Error("API returned no school schedule");
    if (!Array.isArray(payload?.team_statuses)) throw new Error("API returned no team status contract");
    applyTeamStatuses(schoolId, payload.team_statuses);
    return payload.games
      .filter(game => game && (game.scheduled_at || game.canonical_scheduled_at))
      .map(game => mapApiGame(game, school))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  if (typeof sourceLabel === "function") {
    sourceLabel = event => event.sourceLabel || (event.liveData ? "Live schedule" : "Schedule source");
  }
  if (typeof polishedSourceLabel === "function") {
    const legacyPolishedSourceLabel = polishedSourceLabel;
    polishedSourceLabel = event => event.sourceLabel || legacyPolishedSourceLabel(event);
  }

  if (typeof radiusEl !== "undefined") {
    radiusEl.addEventListener("change", () => refreshNearby());
  }

  if (typeof locationLabelEl !== "undefined" && locationLabelEl) {
    new MutationObserver(() => refreshNearby()).observe(locationLabelEl, { childList: true, characterData: true, subtree: true });
  }

  window.LocalBleachersLive = {
    apiBase: API_BASE,
    refreshAll: async () => {
      await refreshCatalog();
      await refreshNearby();
      return { schools: state.catalogCount, games: state.nearbyCount };
    },
    refreshCatalog,
    refreshNearby,
    fetchTeamSchedule,
    getTeamStatus,
    getNearbyEvents: () => nearbyEvents.map(event => ({ ...event, schoolIds: [...event.schoolIds] })),
    getState: () => ({ ...state, failures: { ...state.failures } })
  };

  Promise.allSettled([refreshCatalog(), refreshNearby()]);
})();