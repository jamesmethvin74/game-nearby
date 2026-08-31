(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const API_BASE = String(
    window.LOCALBLEACHERS_API_BASE
      || localStorage.getItem("localBleachersAR:apiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");
  const DRAGONFLY_VOLLEYBALL_URL = "https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0";

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
    return {
      id: school.id,
      name: school.name,
      subtitle: mascot || [city, stateCode].filter(Boolean).join(", ") || "Arkansas school",
      mascot,
      city,
      state: stateCode,
      teamCount: Number(school.team_count || 0),
      short: String(school.name || "?").trim().charAt(0).toUpperCase() || "★"
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
        else teams.push({ id: school.id, name: school.name, short: school.short });
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
    if (game.parser_type === "dragonfly-public" || game.sport === "volleyball") return DRAGONFLY_VOLLEYBALL_URL;
    return API_BASE;
  }

  function mapNearbyGame(game) {
    const schoolIds = [...new Set([
      game.school_id,
      game.canonical_home_school_id,
      game.canonical_away_school_id
    ].filter(Boolean))];
    const home = game.home_away === "home";
    const date = game.scheduled_at || game.canonical_scheduled_at;
    return {
      id: `live:${game.canonical_event_id || game.id}`,
      backendGameId: game.id,
      backendCanonicalEventId: game.canonical_event_id || null,
      liveData: true,
      dataTrust: game.data_trust || "SINGLE_SOURCE_LIVE",
      sourceConflictCount: Number(game.conflict_count || 0),
      teamId: game.school_id,
      schoolIds,
      team: game.school_name || "Arkansas school",
      sport: game.sport,
      gender: game.gender || "",
      level: game.level || "high-school",
      opponent: game.opponent || "Opponent TBA",
      date,
      home,
      lat: game.latitude == null ? NaN : Number(game.latitude),
      lon: game.longitude == null ? NaN : Number(game.longitude),
      venue: game.venue || game.canonical_venue || "Venue TBA",
      source: "live",
      sourceLabel: game.source_type === "official-conference" ? "Arkansas varsity schedule" : "Live schedule",
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
    if (!Array.isArray(games) || typeof events === "undefined") return false;
    const mapped = games
      .filter(game => game && (game.scheduled_at || game.canonical_scheduled_at))
      .map(mapNearbyGame)
      .filter(game => Number.isFinite(game.lat) && Number.isFinite(game.lon));

    events.splice(0, events.length, ...mapped);
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
      console.warn("Statewide nearby games refresh failed; keeping last-known UI data", error);
      return state.nearbyCount;
    }
  }

  if (typeof sourceLabel === "function") {
    sourceLabel = event => event.sourceLabel || (event.liveData ? "Live schedule" : "Schedule source");
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
    getState: () => ({ ...state, failures: { ...state.failures } })
  };

  Promise.allSettled([refreshCatalog(), refreshNearby()]);
})();