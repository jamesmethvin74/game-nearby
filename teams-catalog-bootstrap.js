(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const CACHE_KEY = "localBleachersAR:schoolCatalog:v1";
  const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const FALLBACK_SCHOOLS = [
    { id:"conway", name:"Conway High School", mascot:"Wampus Cats", city:"Conway", state:"AR", level:"high-school" },
    { id:"greenbrier", name:"Greenbrier High School", mascot:"Panthers", city:"Greenbrier", state:"AR", level:"high-school" },
    { id:"vilonia", name:"Vilonia High School", mascot:"Eagles", city:"Vilonia", state:"AR", level:"high-school" },
    { id:"mayflower", name:"Mayflower High School", mascot:"Eagles", city:"Mayflower", state:"AR", level:"high-school" },
    { id:"maumelle", name:"Maumelle High School", mascot:"Hornets", city:"Maumelle", state:"AR", level:"high-school" },
    { id:"uca", name:"University of Central Arkansas", mascot:"Bears / Sugar Bears", city:"Conway", state:"AR", level:"college" },
    { id:"hendrix", name:"Hendrix College", mascot:"Warriors", city:"Conway", state:"AR", level:"college" },
    { id:"cbc", name:"Central Baptist College", mascot:"Mustangs", city:"Conway", state:"AR", level:"college" }
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

  function installCatalog(schools, source, { cache = false } = {}) {
    if (!Array.isArray(schools)) return 0;
    const normalized = schools
      .map(normalizeSchool)
      .filter(school => school.id && school.name)
      .sort((a, b) => a.name.localeCompare(b.name));
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
    apiBase: DEFAULT_API_BASE
  };

  window.addEventListener("online", () => { void refresh(); });
  void refresh();
})();
