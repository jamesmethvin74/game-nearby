(() => {
  const live = window.LocalBleachersLive;
  if (!live?.fetchTeamSchedule) return;

  const originalFetchTeamSchedule = live.fetchTeamSchedule.bind(live);
  const originalGetTeamStatus = typeof live.getTeamStatus === "function"
    ? live.getTeamStatus.bind(live)
    : () => null;
  const correctedStatuses = new Map();

  const PROXY_LOGO_IDS = new Set([
    "df-6blldr",
    "aaa-ptzw9n",
    "asu-mid-south",
    "asu-mountain-home",
    "asu-newport",
    "cbc",
    "champion-christian",
    "philander-smith",
    "shorter",
    "south-arkansas",
    "sau-tech",
    "uark",
    "ua-cossatot"
  ]);

  function clean(value) {
    return String(value ?? "").trim();
  }

  function statusKey(schoolId, sport, gender = "") {
    return `${schoolId}|${sport}|${gender}`;
  }

  function finiteScore(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function orientToExplicitResult(event = {}) {
    const next = { ...event };
    if (clean(next.status).toUpperCase() !== "FINAL") return next;

    const result = clean(next.result).toUpperCase();
    if (!/^[WLT]$/.test(result)) return next;

    const teamScore = finiteScore(next.teamScore);
    const opponentScore = finiteScore(next.opponentScore);
    if (teamScore === null || opponentScore === null) return next;

    const scoreResult = teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
    const reversible = (result === "W" && scoreResult === "L") || (result === "L" && scoreResult === "W");
    if (!reversible) return next;

    next.teamScore = opponentScore;
    next.opponentScore = teamScore;
    next.previewScoreOrientationCorrected = true;
    return next;
  }

  function recordText(wins, losses, ties = 0) {
    return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  }

  function deriveStatuses(schoolId, events) {
    const groups = new Map();
    for (const event of events || []) {
      const sport = clean(event.sport);
      const gender = clean(event.gender);
      if (!sport) continue;
      const key = statusKey(schoolId, sport, gender);
      if (!groups.has(key)) groups.set(key, { sport, gender, games: [] });
      groups.get(key).games.push(event);
    }

    for (const [key, group] of groups) {
      let wins = 0;
      let losses = 0;
      let ties = 0;
      let conferenceWins = 0;
      let conferenceLosses = 0;
      let conferenceTies = 0;
      let scoredFinals = 0;
      let conferenceFinals = 0;

      for (const event of group.games) {
        if (clean(event.status).toUpperCase() !== "FINAL") continue;
        const teamScore = finiteScore(event.teamScore);
        const opponentScore = finiteScore(event.opponentScore);
        if (teamScore === null || opponentScore === null) continue;

        scoredFinals += 1;
        const result = teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
        if (result === "W") wins += 1;
        else if (result === "L") losses += 1;
        else ties += 1;

        if (event.conferenceGame) {
          conferenceFinals += 1;
          if (result === "W") conferenceWins += 1;
          else if (result === "L") conferenceLosses += 1;
          else conferenceTies += 1;
        }
      }

      if (!scoredFinals) continue;
      const stored = originalGetTeamStatus(schoolId, group.sport, group.gender) || {};
      const storedGames = Number(stored.overall_games || 0);
      if (storedGames > scoredFinals) continue;

      const next = {
        ...stored,
        sport: group.sport,
        gender: group.gender,
        overall_record: recordText(wins, losses, ties),
        overall_games: scoredFinals,
        source: "preview-explicit-result-derived"
      };

      const storedConferenceGames = Number(stored.conference_games || 0);
      if (conferenceFinals > 0 && storedConferenceGames <= conferenceFinals) {
        next.conference_record = recordText(conferenceWins, conferenceLosses, conferenceTies);
        next.conference_games = conferenceFinals;
      }
      correctedStatuses.set(key, next);
    }
  }

  live.fetchTeamSchedule = async schoolId => {
    const raw = await originalFetchTeamSchedule(schoolId);
    const oriented = (raw || []).map(orientToExplicitResult);
    deriveStatuses(schoolId, oriented);
    return oriented;
  };

  live.getTeamStatus = (schoolId, sport, gender = "") => {
    const corrected = correctedStatuses.get(statusKey(schoolId, sport, gender));
    return corrected ? { ...corrected } : originalGetTeamStatus(schoolId, sport, gender);
  };

  function proxyLogoUrl(value) {
    const source = clean(value);
    if (!source) return "";
    try {
      const parsed = new URL(source);
      if (parsed.origin === "https://images.weserv.nl") return parsed.toString();
      const proxy = new URL("https://images.weserv.nl/");
      proxy.searchParams.set("url", parsed.toString());
      proxy.searchParams.set("w", "256");
      proxy.searchParams.set("h", "256");
      proxy.searchParams.set("fit", "contain");
      proxy.searchParams.set("output", "png");
      proxy.searchParams.set("n", "-1");
      return proxy.toString();
    } catch {
      return source;
    }
  }

  function applyPreviewLogoDelivery() {
    const api = window.LocalBleachersSchoolLogos;
    if (!api?.get) return false;
    let changed = false;

    for (const schoolId of PROXY_LOGO_IDS) {
      const logo = api.get(schoolId);
      if (!logo?.logoUrl) continue;
      const proxied = proxyLogoUrl(logo.logoUrl);
      if (!proxied || proxied === logo.logoUrl) continue;
      logo.logoUrl = proxied;
      changed = true;

      if (typeof SCHOOL_REGISTRY !== "undefined") {
        const school = SCHOOL_REGISTRY.find(item => item.id === schoolId);
        if (school) school.logoUrl = proxied;
      }
      if (typeof teams !== "undefined") {
        const team = teams.find(item => item.id === schoolId);
        if (team) team.logoUrl = proxied;
      }
    }

    if (changed && typeof render === "function") {
      try { render(); } catch (error) { console.warn("Preview logo rerender failed", error); }
    }
    return changed;
  }

  document.addEventListener("localbleachers:school-logos", () => {
    queueMicrotask(applyPreviewLogoDelivery);
  });
})();
