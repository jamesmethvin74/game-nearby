(() => {
  const THEME_KEY = "localBleachersAR:theme";
  let currentDateFilter = "upcoming";
  let pickedDate = "";

  const sameLocalDate = (a, b) => (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );

  const startOfDay = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const weekendRange = (now = new Date()) => {
    const day = now.getDay();
    const base = startOfDay(now);
    let fridayOffset;
    if (day === 6) fridayOffset = -1;
    else if (day === 0) fridayOffset = -2;
    else fridayOffset = (5 - day + 7) % 7;
    const start = new Date(base);
    start.setDate(start.getDate() + fridayOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 3);
    return { start, end };
  };

  const matchesDateFilter = (event) => {
    if (currentDateFilter === "upcoming") return true;
    const eventDate = new Date(event.date);
    const now = new Date();
    if (currentDateFilter === "today") return sameLocalDate(eventDate, now);
    if (currentDateFilter === "tomorrow") {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return sameLocalDate(eventDate, tomorrow);
    }
    if (currentDateFilter === "weekend") {
      const { start, end } = weekendRange(now);
      return eventDate >= start && eventDate < end;
    }
    if (currentDateFilter === "pick" && pickedDate) {
      const [year, month, day] = pickedDate.split("-").map(Number);
      return sameLocalDate(eventDate, new Date(year, month - 1, day));
    }
    return true;
  };

  matchesFilter = function(event) {
    const categoryMatch = (() => {
      if (currentFilter === "all") return true;
      if (currentFilter === "high-school" || currentFilter === "college") return event.level === currentFilter;
      if (currentFilter === "male") return event.gender === "boys" || event.gender === "men";
      if (currentFilter === "female") return event.gender === "girls" || event.gender === "women";
      return event.sport === currentFilter;
    })();
    return categoryMatch && matchesDateFilter(event);
  };

  const compactDate = (iso) => new Date(iso).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  const timingLabel = (event) => {
    const date = new Date(event.date);
    const today = new Date();
    if (sameLocalDate(date, today)) return "GAME TODAY";
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (sameLocalDate(date, tomorrow)) return "GAME TOMORROW";
    return "NEXT GAME";
  };

  eventCard = function(event, priority = false) {
    const dist = haversineMiles(center, event);
    const matchup = `${event.home ? "vs." : "at"} ${event.opponent}`;
    const locationClass = event.home ? "home-game" : "away-game";
    const ticket = event.ticketUrl
      ? `<a class="ticket-action" href="${event.ticketUrl}" target="_blank" rel="noopener">Tickets</a>`
      : "";
    const genderLabel = event.gender ? `${capitalize(event.gender)} ` : "";
    const source = typeof polishedSourceLabel === "function" ? polishedSourceLabel(event) : sourceLabel(event);

    if (!priority) {
      return `<article class="event-card ${locationClass}">
        <div class="event-main">
          <div class="team-badge">${badgeFor(event.teamId)}</div>
          <div>
            <div class="event-title">${event.team}</div>
            <div class="matchup-line">${genderLabel}${capitalize(event.sport)} · ${matchup}</div>
            <div class="event-meta">◷ ${compactDate(event.date)} <span class="venue-dot">•</span> ⌖ ${event.venue}</div>
          </div>
          <div class="compact-distance">${dist.toFixed(1)} mi<span class="compact-chevron">›</span></div>
        </div>
      </article>`;
    }

    return `<article class="event-card priority ${locationClass}">
      <span class="game-label">${timingLabel(event)}</span>
      <div class="event-main">
        <div class="team-badge">${badgeFor(event.teamId)}</div>
        <div>
          <div class="event-title">${event.team}</div>
          <div class="matchup-line">${genderLabel}${capitalize(event.sport)} · ${matchup}</div>
          <div class="event-meta">◷ ${compactDate(event.date)} <span class="venue-dot">•</span> ⌖ ${event.venue}${event.notes ? ` · ${event.notes}` : ""}</div>
          <div class="event-meta source-row"><a href="${event.sourceUrl}" target="_blank" rel="noopener">${source}</a></div>
        </div>
        <div class="compact-distance">${dist.toFixed(1)} mi<span class="compact-chevron">›</span></div>
      </div>
      <div class="event-actions"><a href="${directionsUrl(event)}" target="_blank" rel="noopener">▣ Directions</a>${ticket}<a href="${calendarUrl(event)}" target="_blank" rel="noopener">▦ Add to Calendar</a></div>
    </article>`;
  };

  const applyTheme = (theme) => {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    const button = document.querySelector("#themeToggle");
    if (button) {
      button.textContent = next === "dark" ? "☀" : "☾";
      button.setAttribute("aria-label", next === "dark" ? "Switch to light theme" : "Switch to dark theme");
      button.setAttribute("title", next === "dark" ? "Light theme" : "Dark theme");
      button.setAttribute("aria-pressed", String(next === "dark"));
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", next === "dark" ? "#07111f" : "#ffffff");
  };

  const savedTheme = localStorage.getItem(THEME_KEY);
  const preferredTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(savedTheme || preferredTheme);

  document.querySelector("#themeToggle")?.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  const datePicker = document.querySelector("#datePicker");
  document.querySelectorAll(".date-filter").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.dateFilter;
      if (next === "pick") {
        if (datePicker?.showPicker) datePicker.showPicker();
        else datePicker?.click();
        return;
      }
      currentDateFilter = next || "upcoming";
      document.querySelectorAll(".date-filter").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  datePicker?.addEventListener("change", () => {
    pickedDate = datePicker.value;
    if (!pickedDate) return;
    currentDateFilter = "pick";
    document.querySelectorAll(".date-filter").forEach((item) => item.classList.toggle("active", item.dataset.dateFilter === "pick"));
    const pickButton = document.querySelector('[data-date-filter="pick"]');
    if (pickButton) {
      const [year, month, day] = pickedDate.split("-").map(Number);
      pickButton.textContent = new Date(year, month - 1, day).toLocaleDateString([], { month: "short", day: "numeric" });
    }
    render();
  });

  document.querySelector("#alertsBtn")?.addEventListener("click", () => {
    alert("Game alerts are not enabled yet. This layout leaves the control ready for that feature.");
  });
  document.querySelector("#alertsNav")?.addEventListener("click", () => {
    document.querySelector("#alertsBtn")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  render();
})();
