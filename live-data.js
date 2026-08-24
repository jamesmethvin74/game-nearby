(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const API_BASE = String(
    window.LOCALBLEACHERS_API_BASE
      || localStorage.getItem("localBleachersAR:apiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");

  const PILOT_TEAMS = [
    { apiId:"uca-football-2026", schoolId:"uca", sport:"football", gender:"men", displayTeam:"UCA Bears" },
    { apiId:"uca-mens-soccer-2026", schoolId:"uca", sport:"soccer", gender:"men", displayTeam:"UCA Bears" },
    { apiId:"uca-volleyball-2026", schoolId:"uca", sport:"volleyball", gender:"women", displayTeam:"UCA Sugar Bears" },
    { apiId:"hendrix-football-2026", schoolId:"hendrix", sport:"football", gender:"men", displayTeam:"Hendrix Warriors" },
    { apiId:"conway-football-2026", schoolId:"conway", sport:"football", gender:"boys", displayTeam:"Conway Wampus Cats" },
    { apiId:"conway-volleyball-2026", schoolId:"conway", sport:"volleyball", gender:"girls", displayTeam:"Conway Wampus Cats" }
  ];

  const state = {
    apiBase: API_BASE,
    lastAttemptAt: null,
    lastSuccessAt: null,
    loadedTeams: new Set(),
    failures: new Map()
  };

  const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const statusKey = item => `${item.schoolId}|${item.sport}|${item.gender}`;
  const cacheKey = item => `localBleachersAR:live:${item.apiId}`;

  function recordText(wins=0, losses=0, ties=0) {
    return Number(ties) ? `${Number(wins)||0}-${Number(losses)||0}-${Number(ties)||0}` : `${Number(wins)||0}-${Number(losses)||0}`;
  }

  function fallbackMatch(item, game) {
    return (typeof events !== "undefined" ? events : []).find(event =>
      event.teamId === item.schoolId
      && event.sport === item.sport
      && (event.gender || "") === item.gender
      && normalize(event.opponent) === normalize(game.opponent)
    );
  }

  function resultNote(game) {
    if (game.status === "FINAL" && game.result && game.team_score != null && game.opponent_score != null) {
      return `${game.result} ${game.team_score}-${game.opponent_score}`;
    }
    if (game.status === "POSTPONED") return "Postponed";
    if (game.status === "CANCELED") return "Canceled";
    return "";
  }

  function mapGame(item, team, game) {
    const fallback = fallbackMatch(item, game);
    const result = resultNote(game);
    const sourceNote = String(game.notes || "").trim();
    const notes = [result, sourceNote, game.scheduled_time_known ? "" : "Time TBA"].filter(Boolean).join(" · ");
    const home = game.home_away === "home" ? true : game.home_away === "away" ? false : Boolean(fallback?.home);
    return {
      id: `live:${game.id}`,
      backendGameId: game.id,
      backendTeamId: item.apiId,
      liveData: true,
      teamId: item.schoolId,
      team: item.displayTeam,
      sport: item.sport,
      gender: item.gender,
      level: team.level,
      opponent: game.opponent,
      date: game.scheduled_at,
      home,
      lat: game.latitude ?? fallback?.lat ?? team.school_latitude,
      lon: game.longitude ?? fallback?.lon ?? team.school_longitude,
      venue: game.venue || fallback?.venue || "Venue TBA",
      source: "official",
      sourceUrl: game.source_url || team.source_url,
      sourceUpdatedAt: game.source_updated_at || game.source_last_successful_fetch_at || team.last_successful_fetch_at,
      status: game.status,
      teamScore: game.team_score,
      opponentScore: game.opponent_score,
      result: game.result,
      conferenceGame: Boolean(game.conference_game),
      notes,
      ticketUrl: fallback?.ticketUrl || ""
    };
  }

  function mergeSchedule(item, team, games) {
    if (!Array.isArray(games) || !games.length || typeof events === "undefined") return false;
    const mapped = games.map(game => mapGame(item, team, game));
    for (let i=events.length-1; i>=0; i--) {
      const event=events[i];
      if (event.teamId === item.schoolId && event.sport === item.sport && (event.gender || "") === item.gender) events.splice(i,1);
    }
    events.push(...mapped);
    return true;
  }

  function mergeRecord(item, team, record) {
    if (typeof TEAM_STATUS === "undefined") return;
    const current = TEAM_STATUS[statusKey(item)] || {};
    TEAM_STATUS[statusKey(item)] = {
      overall: recordText(record?.wins, record?.losses, record?.ties),
      conference: recordText(record?.conference_wins, record?.conference_losses, record?.conference_ties),
      standing: "Not posted",
      conferenceName: team.conference_name || current.conferenceName || "Conference"
    };
  }

  async function fetchJson(path, timeoutMs=5500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_BASE}${path}`, { headers:{"accept":"application/json"}, signal:controller.signal, cache:"no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function readCached(item) {
    try {
      const value = JSON.parse(localStorage.getItem(cacheKey(item)) || "null");
      return value?.team?.team && Array.isArray(value?.schedule?.games) ? value : null;
    } catch { return null; }
  }

  function writeCached(item, payload) {
    try { localStorage.setItem(cacheKey(item), JSON.stringify({...payload,cachedAt:new Date().toISOString()})); } catch {}
  }

  function applyPayload(item, payload, fromCache=false) {
    const team = payload?.team?.team;
    const record = payload?.team?.record;
    const games = payload?.schedule?.games;
    if (!team || !Array.isArray(games) || !games.length) return false;
    const changed = mergeSchedule(item, team, games);
    mergeRecord(item, team, record);
    if (changed) {
      state.loadedTeams.add(item.apiId);
      if (!fromCache) state.lastSuccessAt = new Date().toISOString();
    }
    return changed;
  }

  async function refreshTeam(item) {
    state.lastAttemptAt = new Date().toISOString();
    try {
      const [team, schedule] = await Promise.all([
        fetchJson(`/api/v1/teams/${encodeURIComponent(item.apiId)}`),
        fetchJson(`/api/v1/teams/${encodeURIComponent(item.apiId)}/schedule`)
      ]);
      const payload={team,schedule};
      if (!applyPayload(item,payload,false)) throw new Error("API returned no usable games");
      writeCached(item,payload);
      state.failures.delete(item.apiId);
      if (typeof render === "function") render();
      document.dispatchEvent(new CustomEvent("localbleachers:live-data",{detail:{teamId:item.apiId,source:"api"}}));
      return true;
    } catch (error) {
      state.failures.set(item.apiId,String(error?.message || error));
      const cached=readCached(item);
      if (cached && applyPayload(item,cached,true)) {
        if (typeof render === "function") render();
        document.dispatchEvent(new CustomEvent("localbleachers:live-data",{detail:{teamId:item.apiId,source:"cache"}}));
        return true;
      }
      return false;
    }
  }

  async function refreshAll() {
    await Promise.allSettled(PILOT_TEAMS.map(refreshTeam));
    return state.loadedTeams.size;
  }

  window.LocalBleachersLive = {
    apiBase: API_BASE,
    refreshAll,
    refreshTeam(apiId) {
      const item=PILOT_TEAMS.find(team => team.apiId === apiId);
      return item ? refreshTeam(item) : Promise.resolve(false);
    },
    getState() {
      return {
        apiBase: state.apiBase,
        lastAttemptAt: state.lastAttemptAt,
        lastSuccessAt: state.lastSuccessAt,
        loadedTeams: [...state.loadedTeams],
        failures: Object.fromEntries(state.failures)
      };
    }
  };

  // Rendered hardcoded data remains the immediate fallback. Live data replaces only
  // a pilot team/sport after a complete, non-empty API response succeeds.
  refreshAll();
})();
