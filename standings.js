(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const DEFAULT_SPORT = "football";
  const LAST_SPORT_KEY = "localBleachersAR:standings:lastSport";
  const LAST_CONFERENCES_KEY = "localBleachersAR:standings:lastConferenceBySport";
  const FAVORITES_KEY = "localBleachersAR:standings:favorites";
  const API_BASE = String(
    window.LOCALBLEACHERS_API_BASE
      || localStorage.getItem("localBleachersAR:apiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");

  const sportTrigger = document.getElementById("standingsSportTrigger");
  const conferenceTrigger = document.getElementById("standingsConferenceTrigger");
  const sportValue = document.getElementById("standingsSportValue");
  const conferenceValue = document.getElementById("standingsConferenceValue");
  const pickerDialog = document.getElementById("standingsPickerDialog");
  const pickerTitle = document.getElementById("standingsPickerTitle");
  const pickerOptions = document.getElementById("standingsPickerOptions");
  const pickerClose = document.getElementById("standingsPickerClose");
  const card = document.getElementById("standingsCard");
  const body = document.getElementById("standingsBody");
  const tableWrap = document.getElementById("standingsTableWrap");
  const status = document.getElementById("standingsStatus");
  const title = document.getElementById("standingsTitle");
  const sportLabel = document.getElementById("standingsSportLabel");
  const updated = document.getElementById("standingsUpdated");
  const source = document.getElementById("standingsSource");
  const sourceLink = document.getElementById("standingsSourceLink");
  const favoriteToggle = document.getElementById("standingsFavoriteToggle");
  const favoritesGrid = document.getElementById("favoriteStandingsGrid");
  const favoritesEmpty = document.getElementById("favoriteStandingsEmpty");
  const favoritesCount = document.getElementById("favoriteStandingsCount");
  const themeToggle = document.getElementById("themeToggle");

  let requestSerial = 0;
  let sports = [
    { id: "football", label: "Football" },
    { id: "volleyball", label: "Volleyball" }
  ];
  let conferences = [];
  let selectedSport = readStoredString(LAST_SPORT_KEY) || DEFAULT_SPORT;
  let lastConferenceBySport = readStoredObject(LAST_CONFERENCES_KEY);
  let selectedConference = String(lastConferenceBySport[selectedSport] || "");
  let favorites = readFavorites();
  let activePicker = null;
  let activeTrigger = null;

  function readStoredString(key) {
    try { return String(localStorage.getItem(key) || "").trim(); }
    catch { return ""; }
  }

  function readStoredObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function readFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      if (!Array.isArray(value)) return [];
      const seen = new Set();
      return value.filter(item => {
        const sport = String(item?.sport || "").trim();
        const conferenceId = String(item?.conferenceId || "").trim();
        const key = `${sport}::${conferenceId}`;
        if (!sport || !conferenceId || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(item => ({
        sport: String(item.sport),
        conferenceId: String(item.conferenceId),
        conferenceName: String(item.conferenceName || "")
      }));
    } catch {
      return [];
    }
  }

  function saveSelection() {
    try {
      localStorage.setItem(LAST_SPORT_KEY, selectedSport);
      if (selectedConference) {
        lastConferenceBySport = { ...lastConferenceBySport, [selectedSport]: selectedConference };
        localStorage.setItem(LAST_CONFERENCES_KEY, JSON.stringify(lastConferenceBySport));
      }
    } catch {}
  }

  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); }
    catch {}
  }

  function favoriteKey(sport, conferenceId) {
    return `${sport}::${conferenceId}`;
  }

  function currentFavoriteKey() {
    return selectedConference ? favoriteKey(selectedSport, selectedConference) : "";
  }

  function isCurrentFavorite() {
    const key = currentFavoriteKey();
    return Boolean(key && favorites.some(item => favoriteKey(item.sport, item.conferenceId) === key));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function titleFromSlug(value = "") {
    return String(value)
      .split("-")
      .filter(Boolean)
      .map(part => /^\d+a$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  async function fetchJson(path) {
    const response = await fetch(`${API_BASE}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
    return payload;
  }

  function setLoading(message = "Loading current standings…") {
    card.setAttribute("aria-busy", "true");
    status.classList.remove("standings-error");
    status.textContent = message;
    status.hidden = false;
    tableWrap.hidden = true;
    source.hidden = true;
    updated.textContent = "";
  }

  function setError(message) {
    card.setAttribute("aria-busy", "false");
    status.textContent = message;
    status.classList.add("standings-error");
    status.hidden = false;
    tableWrap.hidden = true;
    source.hidden = true;
  }

  function itemLabel(items, id, fallback = "Choose") {
    return items.find(item => item.id === id)?.name
      || items.find(item => item.id === id)?.label
      || fallback;
  }

  function updateFavoriteToggle() {
    if (!favoriteToggle) return;
    const favorited = isCurrentFavorite();
    favoriteToggle.disabled = !selectedConference;
    favoriteToggle.classList.toggle("is-favorite", favorited);
    favoriteToggle.textContent = favorited ? "★ Favorited" : "☆ Favorite";
    const conferenceName = itemLabel(conferences, selectedConference, titleFromSlug(selectedConference));
    favoriteToggle.setAttribute("aria-label", favorited
      ? `Remove ${conferenceName} ${itemLabel(sports, selectedSport, selectedSport)} from favorites`
      : `Favorite ${conferenceName} ${itemLabel(sports, selectedSport, selectedSport)} standings`);
  }

  function renderFavorites() {
    favorites = readFavorites();
    if (!favoritesGrid || !favoritesEmpty || !favoritesCount) return;
    favoritesCount.textContent = `${favorites.length} saved`;
    favoritesEmpty.hidden = favorites.length > 0;
    favoritesGrid.hidden = favorites.length === 0;
    favoritesGrid.innerHTML = favorites.map(item => {
      const key = favoriteKey(item.sport, item.conferenceId);
      const sportName = itemLabel(sports, item.sport, titleFromSlug(item.sport));
      const conferenceName = item.conferenceName || titleFromSlug(item.conferenceId);
      const active = key === currentFavoriteKey();
      return `
        <article class="favorite-standings-card${active ? " active" : ""}">
          <button type="button" class="favorite-standings-open" data-favorite-open="${escapeHtml(key)}">
            <span class="favorite-standings-sport">${escapeHtml(sportName)}</span>
            <strong>${escapeHtml(conferenceName)}</strong>
            <span class="favorite-standings-view">View standings →</span>
          </button>
          <button type="button" class="favorite-standings-remove" data-favorite-remove="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(conferenceName)} ${escapeHtml(sportName)} from favorites">★</button>
        </article>`;
    }).join("");
    updateFavoriteToggle();
  }

  function refreshTriggers() {
    sportTrigger.dataset.value = selectedSport;
    sportValue.textContent = itemLabel(sports, selectedSport, "Sport");
    conferenceTrigger.dataset.value = selectedConference;
    conferenceValue.textContent = selectedConference ? itemLabel(conferences, selectedConference, titleFromSlug(selectedConference)) : "Choose";
    conferenceTrigger.disabled = !conferences.length;
    updateFavoriteToggle();
  }

  function populateSports(nextSports) {
    if (Array.isArray(nextSports) && nextSports.length) sports = nextSports;
    if (!sports.some(item => item.id === selectedSport)) {
      selectedSport = sports.some(item => item.id === DEFAULT_SPORT) ? DEFAULT_SPORT : (sports[0]?.id || DEFAULT_SPORT);
      selectedConference = String(lastConferenceBySport[selectedSport] || "");
    }
    saveSelection();
    refreshTriggers();
    renderFavorites();
  }

  function populateConferences(nextConferences) {
    conferences = Array.isArray(nextConferences) ? nextConferences : [];
    const remembered = String(lastConferenceBySport[selectedSport] || "");
    if (!conferences.some(item => item.id === selectedConference)) {
      selectedConference = conferences.some(item => item.id === remembered)
        ? remembered
        : (conferences[0]?.id || "");
    }
    saveSelection();
    refreshTriggers();
    renderFavorites();
  }

  function closePicker() {
    if (pickerDialog.open) pickerDialog.close();
    activePicker = null;
    const trigger = activeTrigger;
    activeTrigger = null;
    trigger?.focus({ preventScroll: true });
  }

  function openPicker(kind) {
    const items = kind === "sport" ? sports : conferences;
    const selected = kind === "sport" ? selectedSport : selectedConference;
    if (!items.length) return;
    activePicker = kind;
    activeTrigger = kind === "sport" ? sportTrigger : conferenceTrigger;
    pickerTitle.textContent = kind === "sport" ? "Sport" : "Conference";
    pickerOptions.innerHTML = items.map(item => {
      const value = item.id;
      const label = item.name || item.label || item.id;
      const checked = value === selected;
      return `<button type="button" class="standings-picker-option${checked ? " selected" : ""}" role="option" aria-selected="${checked}" data-picker-value="${escapeHtml(value)}"><span>${escapeHtml(label)}</span><span class="standings-picker-check" aria-hidden="true">${checked ? "✓" : ""}</span></button>`;
    }).join("");
    pickerDialog.showModal();
    pickerOptions.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  function renderStandings(payload) {
    const rows = Array.isArray(payload?.standings) ? payload.standings : [];
    const conference = payload?.conference || {};
    sportLabel.textContent = String(conference.sport || selectedSport || "sport").toUpperCase();
    title.textContent = conference.name || "Conference standings";
    body.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="rank-col">${escapeHtml(row.rank ?? index + 1)}</td>
        <td class="standings-team">${escapeHtml(row.school_name)}</td>
        <td class="standings-record conf-col">${escapeHtml(row.conference_record || "0-0")}</td>
        <td class="standings-record overall-col">${escapeHtml(row.overall_record || "0-0")}</td>
        <td class="standings-pct pct-col">${escapeHtml(row.conference_pct || "—")}</td>
      </tr>`).join("");

    status.hidden = true;
    tableWrap.hidden = false;
    card.setAttribute("aria-busy", "false");
    updated.textContent = payload?.retrieved_at ? `Updated ${new Date(payload.retrieved_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
    if (conference.source_url) {
      sourceLink.href = conference.source_url;
      source.hidden = false;
    } else {
      source.hidden = true;
    }
    renderFavorites();
  }

  async function loadStandings() {
    if (!selectedConference) {
      setError("No conference is available for this sport yet.");
      return;
    }
    saveSelection();
    const serial = ++requestSerial;
    setLoading();
    try {
      const payload = await fetchJson(`/api/v1/standings?sport=${encodeURIComponent(selectedSport)}&conference=${encodeURIComponent(selectedConference)}`);
      if (serial !== requestSerial) return;
      renderStandings(payload);
    } catch (error) {
      if (serial !== requestSerial) return;
      setError(`Standings are temporarily unavailable. ${error?.message || error}`);
    }
  }

  async function loadConferences() {
    const serial = ++requestSerial;
    setLoading("Loading conferences…");
    conferenceTrigger.disabled = true;
    conferenceValue.textContent = "Loading…";
    try {
      const payload = await fetchJson(`/api/v1/standings/options?sport=${encodeURIComponent(selectedSport)}`);
      if (serial !== requestSerial) return;
      populateSports(payload?.sports);
      populateConferences(payload?.conferences);
      await loadStandings();
    } catch (error) {
      if (serial !== requestSerial) return;
      populateConferences([]);
      setError(`Conference list is temporarily unavailable. ${error?.message || error}`);
    }
  }

  function toggleCurrentFavorite() {
    if (!selectedConference) return;
    const key = currentFavoriteKey();
    if (favorites.some(item => favoriteKey(item.sport, item.conferenceId) === key)) {
      favorites = favorites.filter(item => favoriteKey(item.sport, item.conferenceId) !== key);
    } else {
      favorites.push({
        sport: selectedSport,
        conferenceId: selectedConference,
        conferenceName: itemLabel(conferences, selectedConference, titleFromSlug(selectedConference))
      });
    }
    saveFavorites();
    renderFavorites();
  }

  async function openFavorite(key) {
    const favorite = favorites.find(item => favoriteKey(item.sport, item.conferenceId) === key);
    if (!favorite) return;
    selectedSport = favorite.sport;
    selectedConference = favorite.conferenceId;
    saveSelection();
    refreshTriggers();
    await loadConferences();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function removeFavorite(key) {
    favorites = favorites.filter(item => favoriteKey(item.sport, item.conferenceId) !== key);
    saveFavorites();
    renderFavorites();
  }

  function setThemeIcon() {
    if (!themeToggle) return;
    const dark = document.documentElement.dataset.theme === "dark";
    themeToggle.textContent = dark ? "☀" : "☾";
    themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }

  sportTrigger.addEventListener("click", () => openPicker("sport"));
  conferenceTrigger.addEventListener("click", () => openPicker("conference"));
  favoriteToggle?.addEventListener("click", toggleCurrentFavorite);
  pickerClose.addEventListener("click", closePicker);
  pickerDialog.addEventListener("click", event => { if (event.target === pickerDialog) closePicker(); });
  pickerOptions.addEventListener("click", event => {
    const option = event.target.closest("[data-picker-value]");
    if (!option || !activePicker) return;
    const value = option.dataset.pickerValue;
    const kind = activePicker;
    closePicker();
    if (kind === "sport") {
      if (value === selectedSport) return;
      selectedSport = value;
      selectedConference = String(lastConferenceBySport[selectedSport] || "");
      saveSelection();
      refreshTriggers();
      loadConferences();
      return;
    }
    if (value === selectedConference) return;
    selectedConference = value;
    saveSelection();
    refreshTriggers();
    loadStandings();
  });

  favoritesGrid?.addEventListener("click", event => {
    const remove = event.target.closest("[data-favorite-remove]");
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      removeFavorite(remove.dataset.favoriteRemove);
      return;
    }
    const open = event.target.closest("[data-favorite-open]");
    if (open) openFavorite(open.dataset.favoriteOpen);
  });

  window.addEventListener("storage", event => {
    if (event.key === FAVORITES_KEY) renderFavorites();
  });

  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("localBleachersAR:theme", next);
    setThemeIcon();
  });

  saveSelection();
  refreshTriggers();
  renderFavorites();
  setThemeIcon();
  loadConferences();
})();
