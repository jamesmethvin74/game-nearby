(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const API_BASE = String(
    window.LOCALBLEACHERS_API_BASE
      || localStorage.getItem("localBleachersAR:apiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");
  const DRAGONFLY_VOLLEYBALL_URL = "https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0";
  const RECORD_CACHE_KEY = "localBleachersAR:recordCache:v1";

  const nearbyEvents = [];
  const recordCache = new Map();
  const recordRequests = new Map();
  const standingsRequests = new Map();
  const state = {
    apiBase: API_BASE,
    catalogLoadedAt: null,
    nearbyLoadedAt: null,
    catalogCount: 0,
    nearbyCount: 0,
    recordCount: 0,
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

  function recordKey(event) {
    return `${event?.teamId || ""}|${event?.sport || ""}|${event?.gender || ""}`;
  }

  function loadRecordCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(RECORD_CACHE_KEY) || "{}");
      for (const [key, value] of Object.entries(saved || {})) {
        const record = normalizeRecord(value);
        if (record) recordCache.set(key, record);
      }
      state.recordCount = recordCache.size;
    } catch {}
  }

  function persistRecordCache() {
    try {
      localStorage.setItem(RECORD_CACHE_KEY, JSON.stringify(Object.fromEntries(recordCache)));
    } catch {}
  }

  function cacheRecordForEvent(event, value) {
    const record = normalizeRecord(value);
    if (!record || !event?.teamId || !event?.sport) return null;
    recordCache.set(recordKey(event), record);
    state.recordCount = recordCache.size;
    persistRecordCache();
    return record;
  }

  function getRecordForEvent(event) {
    const inline = normalizeRecord(event?.record);
    if (inline && (!event?.recordOwnerTeamId || event.recordOwnerTeamId === event.teamId)) return inline;
    return recordCache.get(recordKey(event)) || null;
  }

  function parseRecordText(value) {
    const match = String(value || "").trim().match(/^(\d+)-(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    return { wins:Number(match[1]), losses:Number(match[2]), ties:Number(match[3] || 0) };
  }

  function conferenceNameForEvent(event) {
    if (event?.record?.conference_name) return event.record.conference_name;
    if (event?.conferenceName) return event.conferenceName;
    try {
      const key = recordKey(event);
      if (typeof TEAM_CONFERENCE_FALLBACKS !== "undefined" && TEAM_CONFERENCE_FALLBACKS[key]) return TEAM_CONFERENCE_FALLBACKS[key];
    } catch {}
    return "";
  }

  function conferenceSlug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizedSchoolName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\bhigh school\b/g, " ")
      .replace(/\bhs\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function schoolNamesForEvent(event) {
    const names = [event?.team];
    try {
      if (typeof SCHOOL_REGISTRY !== "undefined") {
        const school = SCHOOL_REGISTRY.find(item => item.id === event?.teamId);
        if (school) names.push(school.name, school.providerName);
      }
    } catch {}
    return [...new Set(names.map(normalizedSchoolName).filter(Boolean))];
  }

  function standingsRowForEvent(event, rows) {
    const candidates = schoolNamesForEvent(event);
    return (rows || []).find(row => {
      const rowName = normalizedSchoolName(row?.school_name);
      return candidates.some(name => rowName === name || rowName.startsWith(`${name} `) || name.startsWith(`${rowName} `));
    }) || null;
  }

  async function fetchPublishedRecord(event) {
    if (event?.level !== "high-school" || !["football","volleyball"].includes(event?.sport)) return null;
    const conferenceName = conferenceNameForEvent(event);
    const slug = conferenceSlug(conferenceName);
    if (!slug) return null;
    const standingsKey = `${event.sport}|${slug}`;
    let pending = standingsRequests.get(standingsKey);
    if (!pending) {
      pending = fetchJson(`/api/v1/standings?sport=${encodeURIComponent(event.sport)}&conference=${encodeURIComponent(slug)}`, 15000)
        .finally(() => standingsRequests.delete(standingsKey));
      standingsRequests.set(standingsKey, pending);
    }
    const payload = await pending;
    const row = standingsRowForEvent(event, payload?.standings);
    if (!row) return null;
    const overall = parseRecordText(row.overall_record);
    const conference = parseRecordText(row.conference_record);
    if (!overall) return null;
    return normalizeRecord({
      wins:overall.wins,losses:overall.losses,ties:overall.ties,
      conference_wins:conference?.wins || 0,conference_losses:conference?.losses || 0,conference_ties:conference?.ties || 0,
      conference_id:payload?.conference?.id || slug,
      conference_name:payload?.conference?.name || conferenceName,
      rank:row.rank,
      calculated_at:payload?.retrieved_at || new Date().toISOString()
    });
  }

  function backendTeamIdForEvent(event) {
    const key = recordKey(event);
    const known = {
      "uca|football|men":"uca-football-2026",
      "hendrix|football|men":"hendrix-football-2026",
      "conway|football|boys":"conway-football-2026",
      "uca|volleyball|women":"uca-volleyball-2026"
    };
    if (known[key]) return known[key];
    if (event?.sport === "volleyball" && event?.teamId) return `${event.teamId}-volleyball-2026`;
    return null;
  }

  async function fetchBackendRecord(event) {
    const teamId = backendTeamIdForEvent(event);
    if (!teamId) return null;
    const payload = await fetchJson(`/api/v1/teams/${encodeURIComponent(teamId)}/record`, 12000);
    return normalizeRecord(payload?.record);
  }

  async function fetchRecordForEvent(event) {
    if (!event?.teamId || !event?.sport) return null;
    const key = recordKey(event);
    const cached = recordCache.get(key);
    if (cached) return cached;
    if (recordRequests.has(key)) return recordRequests.get(key);

    const pending = (async () => {
      let record = null;
      try {
        if (event.level === "high-school" && event.sport === "football") record = await fetchPublishedRecord(event);
      } catch {}
      if (!record) {
        try { record = await fetchBackendRecord(event); } catch {}
      }
      if (!record) {
        try { record = await fetchPublishedRecord(event); } catch {}
      }
      if (record) cacheRecordForEvent(event, record);
      return record;
    })().finally(() => recordRequests.delete(key));

    recordRequests.set(key, pending);
    return pending;
  }

  async function refreshRecordsForEvents(inputEvents) {
    const unique = new Map();
    for (const event of inputEvents || []) {
      if (!event?.teamId || !event?.sport) continue;
      if (getRecordForEvent(event)) continue;
      unique.set(recordKey(event), event);
    }
    if (!unique.size) return 0;
    const results = await Promise.allSettled([...unique.values()].map(fetchRecordForEvent));
    const restored = results.filter(result => result.status === "fulfilled" && result.value).length;
    if (restored && typeof render === "function") render();
    if (restored) document.dispatchEvent(new CustomEvent("localbleachers:records", { detail: { restored, cached:recordCache.size } }));
    return restored;
  }

  loadRecordCache();

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
    const mapped = {
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
      recordOwnerTeamId: schoolId,
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
    if (record) cacheRecordForEvent(mapped, record);
    else mapped.record = getRecordForEvent(mapped);
    return mapped;
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
      await refreshRecordsForEvents(nearbyEvents);
      return state.nearbyCount;
    } catch (error) {
      if (requestId !== state.nearbyRequest) return state.nearbyCount;
      state.failures.nearby = String(error?.message || error);
      console.warn("Statewide nearby games refresh failed; keeping last-known nearby data", error);
      return state.nearbyCount;
    }
  }

  function teamIdForSchool(schoolId) {
    return `${schoolId}-volleyball-2026`;
  }

  async function fetchTeamSchedule(schoolId) {
    const school = (typeof SCHOOL_REGISTRY !== "undefined" ? SCHOOL_REGISTRY : []).find(item => item.id === schoolId)
      || { id: schoolId, name: schoolId, level: "high-school" };
    const teamId = teamIdForSchool(schoolId);
    const payload = await fetchJson(`/api/v1/teams/${encodeURIComponent(teamId)}/schedule`, 15000);
    if (!Array.isArray(payload?.games)) throw new Error("API returned no team schedule");
    const record = normalizeRecord(payload?.record);
    const mapped = payload.games
      .filter(game => game && (game.scheduled_at || game.canonical_scheduled_at))
      .map(game => mapApiGame(game, school, record))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (mapped[0] && record) cacheRecordForEvent(mapped[0], record);
    return mapped;
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
      const fallback = typeof events !== "undefined" ? events : [];
      await refreshRecordsForEvents([...fallback, ...nearbyEvents]);
      return { schools: state.catalogCount, games: state.nearbyCount, records: state.recordCount };
    },
    refreshCatalog,
    refreshNearby,
    refreshRecordsForEvents,
    fetchTeamSchedule,
    getRecordForEvent,
    getNearbyEvents: () => nearbyEvents.map(event => ({ ...event, schoolIds: [...event.schoolIds] })),
    getState: () => ({ ...state, failures: { ...state.failures } })
  };

  Promise.allSettled([refreshCatalog(), refreshNearby()]).then(() => {
    const fallback = typeof events !== "undefined" ? events : [];
    return refreshRecordsForEvents([...fallback, ...nearbyEvents]);
  });
})();
