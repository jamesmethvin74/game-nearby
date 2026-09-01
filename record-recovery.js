(() => {
  const live = window.LocalBleachersLive;
  if (!live) return;

  const CACHE_KEY = "localBleachersAR:collegeRecordCache:v1";
  const API_BASE = String(live.apiBase || "").replace(/\/$/, "");
  const records = new Map();
  const pending = new Map();
  const originalGetRecordForEvent = typeof live.getRecordForEvent === "function"
    ? live.getRecordForEvent.bind(live)
    : () => null;

  function keyFor(event) {
    return `${event?.teamId || ""}|${event?.sport || ""}|${event?.gender || ""}`;
  }

  function normalizeRecord(value) {
    if (!value) return null;
    const fields = ["wins","losses","ties","conference_wins","conference_losses","conference_ties"];
    if (!fields.some(field => value[field] != null)) return null;
    const number = field => Number(value[field] || 0);
    return {
      wins:number("wins"), losses:number("losses"), ties:number("ties"),
      conference_wins:number("conference_wins"), conference_losses:number("conference_losses"), conference_ties:number("conference_ties"),
      conference_id:value.conference_id || null,
      conference_name:value.conference_name || null,
      rank:value.rank == null ? null : Number(value.rank),
      calculated_at:value.calculated_at || null,
      source_url:value.source_url || null,
      source_type:value.source_type || null
    };
  }

  function loadCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      for (const [key, value] of Object.entries(saved || {})) {
        const record = normalizeRecord(value);
        if (record) records.set(key, record);
      }
    } catch {}
  }

  function persistCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(records))); } catch {}
  }

  async function fetchCollegeRecord(event) {
    if (event?.level !== "college" || !event?.teamId || !event?.sport || !event?.gender || !API_BASE) return null;
    const key = keyFor(event);
    if (pending.has(key)) return pending.get(key);

    const request = (async () => {
      const params = new URLSearchParams({ school:event.teamId, sport:event.sport, gender:event.gender });
      const response = await fetch(`${API_BASE}/api/v1/college-record?${params.toString()}`, {
        headers:{ accept:"application/json" }, cache:"no-store"
      });
      if (!response.ok) return records.get(key) || null;
      const payload = await response.json();
      const record = normalizeRecord(payload?.record);
      if (!record) return records.get(key) || null;
      records.set(key, record);
      persistCache();
      return record;
    })().catch(() => records.get(key) || null).finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  }

  async function refreshCollegeRecords(inputEvents) {
    const unique = new Map();
    for (const event of inputEvents || []) {
      if (event?.level !== "college") continue;
      unique.set(keyFor(event), event);
    }
    if (!unique.size) return 0;
    const results = await Promise.allSettled([...unique.values()].map(fetchCollegeRecord));
    const loaded = results.filter(result => result.status === "fulfilled" && result.value).length;
    if (loaded && typeof render === "function") render();
    if (loaded) document.dispatchEvent(new CustomEvent("localbleachers:college-records", { detail:{ loaded } }));
    return loaded;
  }

  loadCache();

  live.getRecordForEvent = event => originalGetRecordForEvent(event) || records.get(keyFor(event)) || null;
  live.refreshCollegeRecords = refreshCollegeRecords;

  const allEvents = typeof events !== "undefined" ? events : [];
  void refreshCollegeRecords(allEvents);
})();
