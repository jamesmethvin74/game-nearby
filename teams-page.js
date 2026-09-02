(() => {
  const DEFAULT_FOLLOWED = ["uca", "conway"];
  const FALLBACK_COLLEGES = [
    { id:"uca", name:"University of Central Arkansas", mascot:"Bears / Sugar Bears", city:"Conway", state:"AR", level:"college", short:"UCA" },
    { id:"hendrix", name:"Hendrix College", mascot:"Warriors", city:"Conway", state:"AR", level:"college", short:"H" },
    { id:"cbc", name:"Central Baptist College", mascot:"Mustangs", city:"Conway", state:"AR", level:"college", short:"CBC" }
  ];

  const levelEl = document.getElementById("schoolLevel");
  const pickerTrigger = document.getElementById("schoolPickerTrigger");
  const pickerTriggerText = document.getElementById("schoolPickerTriggerText");
  const pickerDialog = document.getElementById("schoolPickerDialog");
  const pickerClose = document.getElementById("schoolPickerClose");
  const pickerSearch = document.getElementById("schoolPickerSearch");
  const pickerEyebrow = document.getElementById("schoolPickerEyebrow");
  const pickerTitle = document.getElementById("schoolPickerTitle");
  const pickerVisibleCount = document.getElementById("schoolPickerVisibleCount");
  const resultsEl = document.getElementById("schoolSearchResults");
  const addStatusEl = document.getElementById("teamAddStatus");
  const catalogCountEl = document.getElementById("schoolCatalogCount");
  const followedCountEl = document.getElementById("followedTeamCount");
  const followedGridEl = document.getElementById("followedTeamsGrid");
  const themeToggle = document.getElementById("themeToggle");

  let followed = readFollowed();

  function readFollowed() {
    try {
      const value = JSON.parse(localStorage.getItem("followedTeams") || JSON.stringify(DEFAULT_FOLLOWED));
      return Array.isArray(value) ? [...new Set(value.filter(Boolean))] : [...DEFAULT_FOLLOWED];
    } catch {
      return [...DEFAULT_FOLLOWED];
    }
  }

  function saveFollowed() {
    localStorage.setItem("followedTeams", JSON.stringify(followed));
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return clean(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function schoolLogo(school) {
    const decorated = window.LocalBleachersSchoolLogos?.get?.(school.id);
    return safeLogoUrl(decorated?.logoUrl || school.logoUrl || school.logo_url);
  }

  function schoolShort(school) {
    return clean(school.short || school.name).charAt(0).toUpperCase() || "★";
  }

  function levelFor(school) {
    return clean(school.level) === "college" ? "college" : "high-school";
  }

  function levelLabel(level) {
    return level === "college" ? "College" : "High School";
  }

  function levelPlural(level) {
    return level === "college" ? "colleges" : "schools";
  }

  function supportedColleges() {
    const explicit = window.LocalBleachersTeamsCatalog?.getColleges?.();
    return Array.isArray(explicit) && explicit.length ? explicit : FALLBACK_COLLEGES;
  }

  function allSchools() {
    const byId = new Map();
    const registry = Array.isArray(SCHOOL_REGISTRY) ? SCHOOL_REGISTRY : [];
    for (const school of registry) {
      if (school?.id) byId.set(school.id, school);
    }
    // Colleges are explicit because the statewide API is primarily the Arkansas
    // high-school catalog. They override any accidental high-school classification.
    for (const college of supportedColleges()) {
      if (!college?.id) continue;
      byId.set(college.id, { ...(byId.get(college.id) || {}), ...college, level:"college" });
    }
    return [...byId.values()].sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
  }

  function schoolById(id) {
    return allSchools().find(school => school.id === id) || null;
  }

  function schoolDetail(school) {
    const parts = [];
    if (school.mascot || school.subtitle) parts.push(clean(school.mascot || school.subtitle));
    const place = [clean(school.city), clean(school.state)].filter(Boolean).join(", ");
    if (place && !parts.includes(place)) parts.push(place);
    return parts.join(" · ") || levelLabel(levelFor(school));
  }

  function logoMarkup(school, className) {
    const logo = schoolLogo(school);
    const fallback = escapeHtml(schoolShort(school));
    return `<span class="${className}"><span>${fallback}</span>${logo ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">` : ""}</span>`;
  }

  function schoolsForCurrentLevel() {
    const level = levelEl.value;
    return allSchools().filter(school => levelFor(school) === level);
  }

  function filteredSchools() {
    const needle = clean(pickerSearch.value).toLowerCase();
    return schoolsForCurrentLevel().filter(school => {
      if (!needle) return true;
      const haystack = [school.name, school.providerName, school.mascot, school.subtitle, school.city, school.state]
        .map(clean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }

  function updatePickerLabels() {
    const college = levelEl.value === "college";
    pickerEyebrow.textContent = college ? "COLLEGE" : "HIGH SCHOOL";
    pickerTitle.textContent = college ? "Choose a college" : "Choose a high school";
    pickerSearch.placeholder = college ? "Search colleges…" : "Search high schools…";
    pickerTriggerText.textContent = college ? "Search colleges…" : "Search schools…";
  }

  function renderSearchResults() {
    followed = readFollowed();
    const schools = filteredSchools();
    pickerVisibleCount.textContent = `${schools.length} ${levelPlural(levelEl.value)}`;

    if (!schools.length) {
      resultsEl.innerHTML = `<div class="school-results-empty">No ${levelLabel(levelEl.value).toLowerCase()} ${levelPlural(levelEl.value)} match that search.</div>`;
      return;
    }

    resultsEl.innerHTML = schools.map(school => {
      const isFollowed = followed.includes(school.id);
      return `
        <div class="school-result" role="option" data-school-id="${escapeHtml(school.id)}">
          ${logoMarkup(school, "school-result-logo")}
          <span class="school-result-copy"><strong>${escapeHtml(school.name)}</strong><small>${escapeHtml(schoolDetail(school))}</small></span>
          <button type="button" class="school-result-follow${isFollowed ? " is-following" : ""}" data-follow-id="${escapeHtml(school.id)}" aria-label="${isFollowed ? "Following" : "Follow"} ${escapeHtml(school.name)}" ${isFollowed ? "disabled" : ""}>${isFollowed ? "Following" : "Follow"}</button>
        </div>`;
    }).join("");
  }

  function openPicker() {
    pickerSearch.value = "";
    updatePickerLabels();
    renderSearchResults();
    if (typeof pickerDialog.showModal === "function") pickerDialog.showModal();
    else pickerDialog.setAttribute("open", "");
  }

  function closePicker() {
    if (typeof pickerDialog.close === "function" && pickerDialog.open) pickerDialog.close();
    else pickerDialog.removeAttribute("open");
  }

  function renderCatalogCount() {
    const level = levelEl.value;
    const count = schoolsForCurrentLevel().length;
    catalogCountEl.textContent = `${count} ${levelPlural(level)}`;
  }

  function renderFollowedTeams() {
    followed = readFollowed();
    const schools = followed.map(id => schoolById(id) || { id, name: id, subtitle: "Loading school details…", level:"high-school", short:id.charAt(0).toUpperCase() });
    followedCountEl.textContent = `${schools.length} team${schools.length === 1 ? "" : "s"}`;

    if (!schools.length) {
      followedGridEl.innerHTML = `<div class="teams-empty"><strong>No teams followed yet.</strong>Use the school picker above to build your list.</div>`;
      return;
    }

    followedGridEl.innerHTML = schools.map(school => `
      <article class="followed-team-card" data-followed-school="${escapeHtml(school.id)}">
        <button type="button" class="followed-team-open team-detail-trigger" data-team-id="${escapeHtml(school.id)}" aria-label="View ${escapeHtml(school.name)} schedules">
          ${logoMarkup(school, "followed-team-logo")}
          <span class="followed-team-copy"><strong>${escapeHtml(school.name)}</strong><span class="mascot">${escapeHtml(schoolDetail(school))}</span><span class="view-schedule">View schedules →</span></span>
        </button>
        <button type="button" class="unfollow-team" data-unfollow-id="${escapeHtml(school.id)}" aria-label="Unfollow ${escapeHtml(school.name)}">Following ✓</button>
      </article>`).join("");
  }

  function followSchool(id) {
    const school = schoolById(id);
    if (!school || followed.includes(id)) return;
    followed.push(id);
    saveFollowed();
    addStatusEl.textContent = `${school.name} added to My Teams.`;
    renderFollowedTeams();
    renderSearchResults();
  }

  function renderAll() {
    followed = readFollowed();
    updatePickerLabels();
    renderCatalogCount();
    renderFollowedTeams();
    if (pickerDialog.open) renderSearchResults();
  }

  levelEl.addEventListener("change", () => {
    addStatusEl.textContent = "";
    pickerSearch.value = "";
    renderAll();
  });

  pickerTrigger.addEventListener("click", openPicker);
  pickerClose.addEventListener("click", closePicker);
  pickerSearch.addEventListener("input", renderSearchResults);
  pickerSearch.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
    }
    if (event.key === "Enter") {
      const first = resultsEl.querySelector(".school-result-follow:not(:disabled)");
      if (first) {
        event.preventDefault();
        followSchool(first.dataset.followId);
      }
    }
  });

  pickerDialog.addEventListener("click", event => {
    if (event.target === pickerDialog) closePicker();
  });

  resultsEl.addEventListener("click", event => {
    const button = event.target.closest(".school-result-follow");
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    followSchool(button.dataset.followId);
  });

  followedGridEl.addEventListener("click", event => {
    const button = event.target.closest(".unfollow-team");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const school = schoolById(button.dataset.unfollowId);
    followed = followed.filter(id => id !== button.dataset.unfollowId);
    saveFollowed();
    addStatusEl.textContent = school ? `${school.name} removed from My Teams.` : "Team removed from My Teams.";
    renderAll();
  });

  document.addEventListener("localbleachers:catalog", renderAll);
  document.addEventListener("localbleachers:school-logos", renderAll);

  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("localBleachersAR:theme", next);
    themeToggle.textContent = next === "dark" ? "☀" : "☾";
    themeToggle.setAttribute("aria-label", next === "dark" ? "Switch to light theme" : "Switch to dark theme");
  });

  if (themeToggle) themeToggle.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾";
  renderAll();
})();