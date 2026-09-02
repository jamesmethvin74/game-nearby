(() => {
  const CATALOG_CACHE_KEY = "localBleachersAR:schoolCatalog:v1";
  const NEARBY_CACHE_KEY = "localBleachersAR:nearbyGames:v1";
  const NEARBY_MAX_AGE_MS = 18 * 60 * 60 * 1000;
  const MIN_STATEWIDE_CATALOG = 100;

  function cloneEvents(events) {
    return (events || []).map(event => ({
      ...event,
      schoolIds: Array.isArray(event.schoolIds) ? [...event.schoolIds] : []
    }));
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("LocalBleachers persistent cache write failed", key, error);
      return false;
    }
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (error) {
      console.warn("LocalBleachers persistent cache read failed", key, error);
      return null;
    }
  }

  function currentLocationSignature() {
    if (typeof center === "undefined" || !center) return null;
    const radius = typeof radiusEl !== "undefined" && radiusEl ? Math.max(1, Number(radiusEl.value) || 25) : 25;
    const lat = Number(center.lat);
    const lon = Number(center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, radius };
  }

  function nearbyCacheMatches(cache) {
    if (!cache || !Array.isArray(cache.events) || !cache.events.length) return false;
    if (!Number.isFinite(Number(cache.savedAt)) || Date.now() - Number(cache.savedAt) > NEARBY_MAX_AGE_MS) return false;
    const current = currentLocationSignature();
    if (!current) return true;
    const lat = Number(cache.lat);
    const lon = Number(cache.lon);
    const radius = Number(cache.radius);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) return false;
    if (Math.abs(lat - current.lat) > 0.08 || Math.abs(lon - current.lon) > 0.08) return false;
    if (Math.abs(radius - current.radius) > 0.5) return false;
    return true;
  }

  function persistCatalog() {
    if (typeof SCHOOL_REGISTRY === "undefined" || !Array.isArray(SCHOOL_REGISTRY)) return false;
    if (SCHOOL_REGISTRY.length < MIN_STATEWIDE_CATALOG) return false;
    const schools = SCHOOL_REGISTRY.map(school => ({ ...school }));
    return writeJson(CATALOG_CACHE_KEY, { savedAt: Date.now(), schools });
  }

  function install() {
    const live = window.LocalBleachersLive;
    if (!live || live.__persistentLastGoodInstalled) return Boolean(live);

    const originalGetNearbyEvents = typeof live.getNearbyEvents === "function"
      ? live.getNearbyEvents.bind(live)
      : () => [];

    const cached = readJson(NEARBY_CACHE_KEY);
    let fallbackEvents = nearbyCacheMatches(cached) ? cloneEvents(cached.events) : [];

    live.getNearbyEvents = () => {
      const current = cloneEvents(originalGetNearbyEvents());
      return current.length ? current : cloneEvents(fallbackEvents);
    };
    live.__persistentLastGoodInstalled = true;

    document.addEventListener("localbleachers:catalog", () => {
      persistCatalog();
    });

    document.addEventListener("localbleachers:nearby-games", () => {
      const current = cloneEvents(originalGetNearbyEvents());
      if (!current.length) return;
      fallbackEvents = cloneEvents(current);
      const signature = currentLocationSignature() || {};
      writeJson(NEARBY_CACHE_KEY, {
        savedAt: Date.now(),
        lat: signature.lat ?? null,
        lon: signature.lon ?? null,
        radius: signature.radius ?? null,
        events: fallbackEvents
      });
    });

    persistCatalog();

    if (fallbackEvents.length && !originalGetNearbyEvents().length && typeof render === "function") {
      queueMicrotask(() => {
        try { render(); } catch (error) { console.warn("Cached nearby render failed", error); }
      });
    }

    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 40) clearInterval(timer);
    }, 50);
  }
})();
