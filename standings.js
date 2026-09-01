(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
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
  const themeToggle = document.getElementById("themeToggle");

  let requestSerial = 0;
  let sports = [{ id: "volleyball", label: "Volleyball" }];
  let conferences = [];
  let selectedSport = "volleyball";
  let selectedConference = "";
  let activePicker = null;
  let activeTrigger = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
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

  function refreshTriggers() {
    sportTrigger.dataset.value = selectedSport;
    sportValue.textContent = itemLabel(sports, selectedSport, "Sport");
    conferenceTrigger.dataset.value = selectedConference;
    conferenceValue.textContent = selectedConference ? itemLabel(conferences, selectedConference, "Conference") : "Choose";
    conferenceTrigger.disabled = !conferences.length;
  }

  function populateSports(nextSports) {
    if (Array.isArray(nextSports) && nextSports.length) sports = nextSports;
    if (!sports.some(item => item.id === selectedSport)) selectedSport = sports[0]?.id || "volleyball";
    refreshTriggers();
  }

  function populateConferences(nextConferences) {
    conferences = Array.isArray(nextConferences) ? nextConferences : [];
    if (!conferences.some(item => item.id === selectedConference)) selectedConference = conferences[0]?.id || "";
    refreshTriggers();
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
  }

  async function loadStandings() {
    if (!selectedConference) {
      setError("No conference is available for this sport yet.");
      return;
    }
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

  function setThemeIcon() {
    if (!themeToggle) return;
    const dark = document.documentElement.dataset.theme === "dark";
    themeToggle.textContent = dark ? "☀" : "☾";
    themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }

  sportTrigger.addEventListener("click", () => openPicker("sport"));
  conferenceTrigger.addEventListener("click", () => openPicker("conference"));
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
      selectedConference = "";
      refreshTriggers();
      loadConferences();
      return;
    }
    if (value === selectedConference) return;
    selectedConference = value;
    refreshTriggers();
    loadStandings();
  });

  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("localBleachersAR:theme", next);
    setThemeIcon();
  });

  refreshTriggers();
  setThemeIcon();
  loadConferences();
})();
