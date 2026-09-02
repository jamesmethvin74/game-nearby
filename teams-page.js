(() => {
  const DEFAULT_FOLLOWED = ["uca", "conway"];
  const levelEl = document.getElementById("schoolLevel");
  const searchEl = document.getElementById("schoolSearch");
  const resultsEl = document.getElementById("schoolSearchResults");
  const addStatusEl = document.getElementById("teamAddStatus");
  const catalogCountEl = document.getElementById("schoolCatalogCount");
  const followedCountEl = document.getElementById("followedTeamCount");
  const followedGridEl = document.getElementById("followedTeamsGrid");
  const themeToggle = document.getElementById("themeToggle");
  const comboboxEl = document.getElementById("schoolCombobox");

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

  function schoolDetail(school) {
    const parts = [];
    if (school.mascot || school.subtitle) parts.push(clean(school.mascot || school.subtitle));
    const place = [clean(school.city), clean(school.state)].filter(Boolean).join(", ");
    if (place && !parts.includes(place)) parts.push(place);
    return parts.join(" · ") || levelLabel(levelFor(school));
  }

  function allSchools() {
    return Array.isArray(SCHOOL_REGISTRY) ? SCHOOL_REGISTRY : [];
  }

  function schoolById(id) {
    return allSchools().find(school => school.id === id) || null;
  }

  function logoMarkup(school, className) {
    const logo = schoolLogo(school);
    const fallback = escapeHtml(schoolShort(school));
    return `<span class="${className}"><span>${fallback}</span>${logo ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">` : ""}</span>`;
  }

  function filteredSchools() {
    const level = levelEl.value;
    const needle = clean(searchEl.value).toLowerCase();
    return allSchools()
      .filter(school => levelFor(school) === level)
      .filter(school => !followed.includes(school.id))
      .filter(school => {
        if (!needle) return true;
        const haystack = [school.name, school.providerName, school.mascot, school.subtitle, school.city, school.state]
          .map(clean).join(" ").toLowerCase();
        return haystack.includes(needle);
      });
  }

  function setPickerOpen(open) {
    resultsEl.hidden = !open;
    searchEl.setAttribute("aria-expanded", open ? "true" : "false");
    document.documentElement.classList.toggle("school-picker-open", open);
    document.body.classList.toggle("school-picker-open", open);
  }

  function renderSearchResults(forceOpen = false) {
    const schools = filteredSchools();
    if (!forceOpen && document.activeElement !== searchEl && resultsEl.hidden) return;

    const summary = `<div class="school-results-summary">${schools.length} ${levelPlural(levelEl.value)} available</div>`;
    if (!schools.length) {
      resultsEl.innerHTML = `${summary}<div class="school-results-empty">No ${levelLabel(levelEl.value).toLowerCase()} schools match that search.</div>`;
    } else {
      resultsEl.innerHTML = summary + schools.map(school => `
        <div class="school-result" role="option" data-school-id="${escapeHtml(school.id)}">
          ${logoMarkup(school, "school-result-logo")}
          <span class="school-result-copy"><strong>${escapeHtml(school.name)}</strong><small>${escapeHtml(schoolDetail(school))}</small></span>
          <button type="button" class="school-result-follow" data-follow-id="${escapeHtml(school.id)}" aria-label="Follow ${escapeHtml(school.name)}">Follow</button>
        </div>`).join("");
    }
    setPickerOpen(true);
  }

  function closeSearchResults() {
    setPickerOpen(false);
  }

  function renderCatalogCount() {
    const level = levelEl.value;
    const count = allSchools().filter(school => levelFor(school) === level).length;
    catalogCountEl.textContent = `${count} ${levelPlural(level)}`;
  }

  function renderFollowedTeams() {
    followed = readFollowed();
    const schools = followed.map(id => schoolById(id) || { id, name: id, subtitle: "Loading school details…", level: "high-school", short: id.charAt(0).toUpperCase() });
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
    renderCatalogCount();
    renderFollowedTeams();
    renderSearchResults(true);
  }

  function renderAll() {
    renderCatalogCount();
    renderFollowedTeams();
    if (!resultsEl.hidden) renderSearchResults(true);
  }

  levelEl.addEventListener("change", () => {
    searchEl.value = "";
    addStatusEl.textContent = "";
    renderCatalogCount();
    if (!resultsEl.hidden || document.activeElement === searchEl) renderSearchResults(true);
  });

  searchEl.addEventListener("focus", () => renderSearchResults(true));
  searchEl.addEventListener("input", () => renderSearchResults(true));
  searchEl.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchResults();
      searchEl.blur();
    }
    if (event.key === "Enter") {
      const first = resultsEl.querySelector(".school-result-follow");
      if (first) {
        event.preventDefault();
        followSchool(first.dataset.followId);
      }
    }
  });

  resultsEl.addEventListener("click", event => {
    const button = event.target.closest(".school-result-follow");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      followSchool(button.dataset.followId);
    }
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

  document.addEventListener("click", event => {
    if (!comboboxEl.contains(event.target)) closeSearchResults();
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
