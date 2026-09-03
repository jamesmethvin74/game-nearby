(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const CACHE_KEY = "localBleachersAR:schoolCatalog:v1";
  const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  // Arkansas colleges and universities that sponsor intercollegiate athletics
  // across NCAA, NAIA, NJCAA, and NCCAA. The live statewide endpoint is
  // primarily a high-school catalog, so these are preserved explicitly when
  // the high-school catalog refreshes. Schedule support is handled separately.
  const COLLEGE_SCHOOLS = [
    // NCAA Division I
    { id:"uark", name:"University of Arkansas", mascot:"Razorbacks", city:"Fayetteville", state:"AR", level:"college", teamCount:1 },
    { id:"arkansas-state", name:"Arkansas State University", mascot:"Red Wolves", city:"Jonesboro", state:"AR", level:"college", teamCount:1 },
    { id:"uapb", name:"University of Arkansas at Pine Bluff", mascot:"Golden Lions", city:"Pine Bluff", state:"AR", level:"college", teamCount:1 },
    { id:"uca", name:"University of Central Arkansas", mascot:"Bears / Sugar Bears", city:"Conway", state:"AR", level:"college", teamCount:1 },
    { id:"little-rock", name:"University of Arkansas at Little Rock", mascot:"Trojans", city:"Little Rock", state:"AR", level:"college", teamCount:1 },

    // NCAA Division II
    { id:"arkansas-tech", name:"Arkansas Tech University", mascot:"Wonder Boys / Golden Suns", city:"Russellville", state:"AR", level:"college", teamCount:1 },
    { id:"uafs", name:"University of Arkansas at Fort Smith", mascot:"Lions", city:"Fort Smith", state:"AR", level:"college", teamCount:1 },
    { id:"uam", name:"University of Arkansas at Monticello", mascot:"Boll Weevils / Cotton Blossoms", city:"Monticello", state:"AR", level:"college", teamCount:1 },
    { id:"harding", name:"Harding University", mascot:"Bisons", city:"Searcy", state:"AR", level:"college", teamCount:1 },
    { id:"henderson-state", name:"Henderson State University", mascot:"Reddies", city:"Arkadelphia", state:"AR", level:"college", teamCount:1 },
    { id:"ouachita-baptist", name:"Ouachita Baptist University", mascot:"Tigers", city:"Arkadelphia", state:"AR", level:"college", teamCount:1 },
    { id:"southern-arkansas", name:"Southern Arkansas University", mascot:"Muleriders", city:"Magnolia", state:"AR", level:"college", teamCount:1 },

    // NCAA Division III
    { id:"hendrix", name:"Hendrix College", mascot:"Warriors", city:"Conway", state:"AR", level:"college", teamCount:1 },
    { id:"lyon", name:"Lyon College", mascot:"Scots", city:"Batesville", state:"AR", level:"college", teamCount:1 },
    { id:"ozarks", name:"University of the Ozarks", mascot:"Eagles", city:"Clarksville", state:"AR", level:"college", teamCount:1 },

    // NAIA
    { id:"arkansas-baptist", name:"Arkansas Baptist College", mascot:"Buffaloes", city:"Little Rock", state:"AR", level:"college", teamCount:1 },
    { id:"cbc", name:"Central Baptist College", mascot:"Mustangs", city:"Conway", state:"AR", level:"college", teamCount:1 },
    { id:"crowleys-ridge", name:"Crowley's Ridge College", mascot:"Pioneers", city:"Paragould", state:"AR", level:"college", teamCount:1 },
    { id:"john-brown", name:"John Brown University", mascot:"Golden Eagles", city:"Siloam Springs", state:"AR", level:"college", teamCount:1 },
    { id:"philander-smith", name:"Philander Smith University", mascot:"Panthers", city:"Little Rock", state:"AR", level:"college", teamCount:1 },
    { id:"williams-baptist", name:"Williams Baptist University", mascot:"Eagles", city:"Walnut Ridge", state:"AR", level:"college", teamCount:1 },

    // NJCAA
    { id:"asu-mid-south", name:"Arkansas State University Mid-South", mascot:"Greyhounds", city:"West Memphis", state:"AR", level:"college", teamCount:1 },
    { id:"asu-mountain-home", name:"Arkansas State University-Mountain Home", mascot:"Trailblazers", city:"Mountain Home", state:"AR", level:"college", teamCount:1 },
    { id:"asu-newport", name:"Arkansas State University-Newport", mascot:"Aviators", city:"Newport", state:"AR", level:"college", teamCount:1 },
    { id:"asu-three-rivers", name:"Arkansas State University Three Rivers", mascot:"Eagles", city:"Malvern", state:"AR", level:"college", teamCount:1 },
    { id:"national-park", name:"National Park College", mascot:"Nighthawks", city:"Hot Springs", state:"AR", level:"college", teamCount:1 },
    { id:"north-arkansas", name:"North Arkansas College", mascot:"Pioneers", city:"Harrison", state:"AR", level:"college", teamCount:1 },
    { id:"nwacc", name:"NorthWest Arkansas Community College", mascot:"Eagles", city:"Bentonville", state:"AR", level:"college", teamCount:1 },
    { id:"shorter", name:"Shorter College", mascot:"Bulldogs", city:"North Little Rock", state:"AR", level:"college", teamCount:1 },
    { id:"south-arkansas", name:"South Arkansas College", mascot:"Stars", city:"El Dorado", state:"AR", level:"college", teamCount:1 },
    { id:"seark", name:"Southeast Arkansas College", mascot:"Sharks", city:"Pine Bluff", state:"AR", level:"college", teamCount:1 },
    { id:"sau-tech", name:"Southern Arkansas University Tech", mascot:"Rockets", city:"Camden", state:"AR", level:"college", teamCount:1 },
    { id:"ua-rich-mountain", name:"University of Arkansas Rich Mountain", mascot:"Bucks", city:"Mena", state:"AR", level:"college", teamCount:1 },
    { id:"ua-cossatot", name:"University of Arkansas Cossatot", mascot:"Colts", city:"De Queen", state:"AR", level:"college", teamCount:1 },

    // NCCAA
    { id:"champion-christian", name:"Champion Christian College", mascot:"Tigers", city:"Hot Springs", state:"AR", level:"college", teamCount:1 },
    { id:"ecclesia", name:"Ecclesia College", mascot:"Royals", city:"Springdale", state:"AR", level:"college", teamCount:1 }
  ];

  const FALLBACK_SCHOOLS = [
    { id:"conway", name:"Conway High School", mascot:"Wampus Cats", city:"Conway", state:"AR", level:"high-school" },
    { id:"greenbrier", name:"Greenbrier High School", mascot:"Panthers", city:"Greenbrier", state:"AR", level:"high-school" },
    { id:"vilonia", name:"Vilonia High School", mascot:"Eagles", city:"Vilonia", state:"AR", level:"high-school" },
    { id:"mayflower", name:"Mayflower High School", mascot:"Eagles", city:"Mayflower", state:"AR", level:"high-school" },
    { id:"maumelle", name:"Maumelle High School", mascot:"Hornets", city:"Maumelle", state:"AR", level:"high-school" },
    ...COLLEGE_SCHOOLS
  ];

  const state = {
    source: "fallback",
    loadedAt: null,
    error: "",
    count: 0,
    refreshing: false
  };

  function clean(value) {
    return String(value ?? "").trim();
  }

  function statusMessage(message = "") {
    const element = document.getElementById("teamAddStatus");
    if (!element) return;
    if (message) {
      element.dataset.catalogStatus = "true";
      element.textContent = message;
    } else if (element.dataset.catalogStatus === "true") {
      delete element.dataset.catalogStatus;
      element.textContent = "";
    }
  }

  function safeLogoUrl(value) {
    const raw = clean(value);
    try {
      const url = new URL(raw);
      return url.protocol === "https:" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function normalizeSchool(school) {
    const providerName = clean(school.name);
    const displayName = clean(school.location_matched_name || school.displayName || providerName) || providerName;
    const mascot = clean(school.mascot || school.subtitle);
    const city = clean(school.city);
    const stateCode = clean(school.state || "AR");
    return {
      id: clean(school.id),
      name: displayName,
      providerName,
      subtitle: mascot || [city, stateCode].filter(Boolean).join(", ") || "Arkansas school",
      mascot,
      city,
      state: stateCode,
      level: clean(school.level) === "college" ? "college" : "high-school",
      teamCount: Number(school.team_count ?? school.teamCount ?? 0),
      logoUrl: safeLogoUrl(school.logo_url || school.logoUrl),
      short: displayName.charAt(0).toUpperCase() || "★"
    };
  }

  function withSupportedColleges(schools) {
    const byId = new Map();
    for (const school of schools || []) {
      const normalized = normalizeSchool(school);
      if (normalized.id && normalized.name) byId.set(normalized.id, normalized);
    }
    // Explicit college definitions win over anything accidentally classified by
    // the high-school feed or restored from an older cache.
    for (const school of COLLEGE_SCHOOLS) {
      const normalized = normalizeSchool(school);
      if (normalized.id && normalized.name) byId.set(normalized.id, normalized);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function installCatalog(schools, source, { cache = false } = {}) {
    if (!Array.isArray(schools)) return 0;
    const normalized = withSupportedColleges(schools);
    if (!normalized.length) return 0;

    if (typeof SCHOOL_REGISTRY !== "undefined") {
      SCHOOL_REGISTRY.splice(0, SCHOOL_REGISTRY.length, ...normalized);
    }

    state.source = source;
    state.loadedAt = new Date().toISOString();
    state.error = "";
    state.count = normalized.length;

    if (cache) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), schools: normalized }));
      } catch (error) {
        console.warn("School catalog cache write failed", error);
      }
    }

    if (source === "network") statusMessage("");
    document.dispatchEvent(new CustomEvent("localbleachers:catalog", {
      detail: { count: normalized.length, source }
    }));
    return normalized.length;
  }

  function restoreCachedCatalog() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!cached || !Array.isArray(cached.schools) || !cached.schools.length) return 0;
      if (!Number.isFinite(Number(cached.savedAt)) || Date.now() - Number(cached.savedAt) > CACHE_MAX_AGE_MS) return 0;
      return installCatalog(cached.schools, "cache");
    } catch (error) {
      console.warn("School catalog cache read failed", error);
      return 0;
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function fetchProductionCatalog(timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${DEFAULT_API_BASE}/api/v1/schools`, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
      if (!Array.isArray(payload?.schools) || !payload.schools.length) throw new Error("API returned no schools");
      return payload.schools;
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh() {
    if (state.refreshing) return state.count;
    state.refreshing = true;
    const waits = [0, 1200, 3500];
    let lastError = null;

    try {
      for (const wait of waits) {
        if (wait) await delay(wait);
        try {
          const schools = await fetchProductionCatalog();
          const count = installCatalog(schools, "network", { cache: true });
          if (count) {
            if (window.LocalBleachersLive) window.LocalBleachersLive.apiBase = DEFAULT_API_BASE;
            return count;
          }
        } catch (error) {
          lastError = error;
          console.warn("Teams school catalog attempt failed", error);
        }
      }

      state.error = String(lastError?.message || lastError || "School catalog unavailable");
      statusMessage(state.source === "fallback"
        ? "The live statewide school list is temporarily unavailable. Showing a limited fallback list and retrying automatically."
        : "The live statewide school list is temporarily unavailable. Showing your last saved school list and retrying automatically.");
      document.dispatchEvent(new CustomEvent("localbleachers:catalog-error", {
        detail: { message: state.error, source: state.source, count: state.count }
      }));
      return state.count;
    } finally {
      state.refreshing = false;
    }
  }

  if (!restoreCachedCatalog()) installCatalog(FALLBACK_SCHOOLS, "fallback");

  window.LocalBleachersTeamsCatalog = {
    refresh,
    getState: () => ({ ...state }),
    getColleges: () => COLLEGE_SCHOOLS.map(normalizeSchool),
    apiBase: DEFAULT_API_BASE
  };

  window.addEventListener("online", () => { void refresh(); });
  void refresh();
})();