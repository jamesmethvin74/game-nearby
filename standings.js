(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const API_BASE = String(
    window.LOCALBLEACHERS_API_BASE
      || localStorage.getItem("localBleachersAR:apiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");

  const sportSelect = document.getElementById("standingsSport");
  const conferenceSelect = document.getElementById("standingsConference");
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
  let sportsLoaded = false;

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

  function populateSports(sports) {
    if (!Array.isArray(sports) || !sports.length || sportsLoaded) return;
    const selected = sportSelect.value;
    sportSelect.innerHTML = sports.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.id)}</option>`).join("");
    if (sports.some(item => item.id === selected)) sportSelect.value = selected;
    sportsLoaded = true;
  }

  function populateConferences(conferences) {
    conferenceSelect.innerHTML = "";
    for (const conference of conferences || []) {
      const option = document.createElement("option");
      option.value = conference.id;
      option.textContent = conference.name;
      conferenceSelect.appendChild(option);
    }
    conferenceSelect.disabled = !conferenceSelect.options.length;
  }

  function renderStandings(payload) {
    const rows = Array.isArray(payload?.standings) ? payload.standings : [];
    const conference = payload?.conference || {};
    sportLabel.textContent = String(conference.sport || sportSelect.value || "sport").toUpperCase();
    title.textContent = conference.name || "Conference standings";
    body.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="rank-col">${escapeHtml(row.rank ?? index + 1)}</td>
        <td class="standings-team">${escapeHtml(row.school_name)}</td>
        <td class="standings-record">${escapeHtml(row.conference_record || "0-0")}</td>
        <td class="standings-record">${escapeHtml(row.overall_record || "0-0")}</td>
        <td>${escapeHtml(row.conference_pct || "—")}</td>
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
    const conference = conferenceSelect.value;
    if (!conference) {
      setError("No conference is available for this sport yet.");
      return;
    }
    const serial = ++requestSerial;
    setLoading();
    try {
      const payload = await fetchJson(`/api/v1/standings?sport=${encodeURIComponent(sportSelect.value)}&conference=${encodeURIComponent(conference)}`);
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
    conferenceSelect.disabled = true;
    try {
      const payload = await fetchJson(`/api/v1/standings/options?sport=${encodeURIComponent(sportSelect.value)}`);
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

  sportSelect.addEventListener("change", loadConferences);
  conferenceSelect.addEventListener("change", loadStandings);
  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("localBleachersAR:theme", next);
    setThemeIcon();
  });

  setThemeIcon();
  loadConferences();
})();
