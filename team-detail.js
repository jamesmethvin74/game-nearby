(() => {
  const state = { schoolId: null, sport: null, gender: null, logo: "" };

  function schoolFor(id) {
    return (typeof SCHOOL_REGISTRY !== "undefined" ? SCHOOL_REGISTRY : []).find(s => s.id === id) ||
      (typeof teams !== "undefined" ? teams : []).find(t => t.id === id) ||
      { id, name: id, subtitle: "" };
  }

  function teamEventsFor(id) {
    return (typeof events !== "undefined" ? events : [])
      .filter(e => e.teamId === id)
      .slice()
      .sort((a,b) => new Date(a.date) - new Date(b.date));
  }

  function keyFor(event) {
    return `${event.sport}|${event.gender || ""}`;
  }

  function titleCase(value) {
    return String(value || "").replace(/(^|[-\s])\w/g, c => c.toUpperCase());
  }

  function sportLabel(sport, gender) {
    const group = gender ? `${titleCase(gender)} ` : "";
    return `${group}${titleCase(sport)}`;
  }

  function displayDate(iso) {
    return new Date(iso).toLocaleString([], {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
  }

  function ensureDialog() {
    let dialog = document.getElementById("teamDetailDialog");
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "teamDetailDialog";
    dialog.className = "team-detail-dialog";
    dialog.innerHTML = `<div class="team-detail-shell">
      <div class="team-detail-header">
        <div id="teamDetailLogo" class="team-detail-logo"></div>
        <div class="team-detail-heading"><div id="teamDetailSchool" class="team-detail-school"></div><div id="teamDetailMascot" class="team-detail-mascot"></div></div>
        <button class="team-detail-close" type="button" aria-label="Close team details">×</button>
      </div>
      <div id="teamDetailSports" class="team-detail-sports" aria-label="Sports"></div>
      <div id="teamDetailStatus" class="team-detail-status"></div>
      <div class="team-detail-section-title"><span>Schedule</span><a id="teamDetailSource" target="_blank" rel="noopener">Official schedule ↗</a></div>
      <div id="teamDetailSchedule" class="team-detail-schedule"></div>
    </div>`;
    document.body.appendChild(dialog);

    const style = document.createElement("style");
    style.textContent = `
      .team-detail-trigger{cursor:pointer;font:inherit;-webkit-tap-highlight-color:transparent}.team-detail-trigger:active{transform:scale(.97)}
      .team-detail-dialog{width:min(680px,calc(100vw - 18px));max-height:min(84vh,760px);padding:0;border:1px solid var(--pitch-line);border-radius:22px;background:var(--pitch-surface);color:var(--pitch-ink);box-shadow:0 24px 70px rgba(0,0,0,.42);overflow:hidden}
      .team-detail-dialog::backdrop{background:rgba(0,0,0,.62);backdrop-filter:blur(3px)}
      .team-detail-shell{max-height:min(84vh,760px);overflow:auto;padding:16px}
      .team-detail-header{display:grid;grid-template-columns:72px minmax(0,1fr) 38px;gap:12px;align-items:center}
      .team-detail-logo{width:72px;height:72px;border-radius:18px;display:grid;place-items:center;overflow:hidden;background:var(--pitch-surface-soft);border:1px solid var(--pitch-line)}
      .team-detail-logo img{width:100%;height:100%;object-fit:contain}.team-detail-logo span{font-size:2rem}
      .team-detail-school{font-size:1.2rem;font-weight:900;line-height:1.05}.team-detail-mascot{margin-top:5px;color:var(--pitch-muted);font-size:.78rem;font-weight:700}
      .team-detail-close{align-self:start;width:36px;height:36px;border:0;border-radius:11px;background:var(--pitch-surface-soft);color:var(--pitch-ink);font-size:1.5rem;line-height:1}
      .team-detail-sports{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;margin:15px 0 12px}.team-detail-sports::-webkit-scrollbar{display:none}
      .team-detail-sport{flex:0 0 auto;border:1px solid var(--pitch-line);border-radius:999px;background:var(--pitch-surface);color:var(--pitch-ink);padding:7px 11px;font-size:.68rem;font-weight:800}.team-detail-sport.active{background:var(--pitch-blue);border-color:var(--pitch-blue);color:#fff}
      .team-detail-status{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--pitch-line);border-radius:14px;overflow:hidden;background:var(--pitch-surface-soft);margin-bottom:16px}
      .team-detail-stat{padding:10px 7px;text-align:center;border-right:1px solid var(--pitch-line)}.team-detail-stat:last-child{border-right:0}.team-detail-stat small{display:block;color:var(--pitch-muted);font-size:.54rem;text-transform:uppercase;letter-spacing:.06em;font-weight:800}.team-detail-stat strong{display:block;margin-top:3px;font-size:.82rem;color:var(--pitch-ink)}
      .team-detail-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 2px 7px;font-size:.8rem;font-weight:900;text-transform:uppercase}.team-detail-section-title a{font-size:.62rem;text-transform:none;color:var(--pitch-blue);font-weight:800;text-decoration:none}
      .team-detail-schedule{border:1px solid var(--pitch-line);border-radius:14px;overflow:hidden;background:var(--pitch-surface)}
      .team-detail-game{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:11px 12px;border-bottom:1px solid var(--pitch-line)}.team-detail-game:last-child{border-bottom:0}.team-detail-game strong{display:block;font-size:.76rem}.team-detail-game .meta{margin-top:3px;color:var(--pitch-muted);font-size:.64rem;line-height:1.35}.team-detail-home{align-self:center;color:var(--pitch-blue);font-size:.58rem;font-weight:900;text-transform:uppercase}.team-detail-empty{padding:18px;color:var(--pitch-muted);text-align:center;font-size:.72rem}
      @media(max-width:520px){.team-detail-dialog{width:100vw;max-width:none;margin:auto 0 0;border-radius:22px 22px 0 0;border-left:0;border-right:0;border-bottom:0;max-height:86vh}.team-detail-shell{max-height:86vh;padding:14px 13px calc(18px + env(safe-area-inset-bottom))}.team-detail-header{grid-template-columns:62px minmax(0,1fr) 34px}.team-detail-logo{width:62px;height:62px;border-radius:15px}.team-detail-school{font-size:1.08rem}}
    `;
    document.head.appendChild(style);

    dialog.querySelector(".team-detail-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  function renderDetail() {
    const dialog = ensureDialog();
    const school = schoolFor(state.schoolId);
    const all = teamEventsFor(state.schoolId);
    const groups = [];
    const seen = new Set();
    all.forEach(event => {
      const key = keyFor(event);
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({ key, sport: event.sport, gender: event.gender || "" });
      }
    });

    if (!groups.length) return;
    let active = groups.find(g => g.sport === state.sport && g.gender === state.gender) || groups[0];
    state.sport = active.sport;
    state.gender = active.gender;

    const selectedEvents = all.filter(e => e.sport === state.sport && (e.gender || "") === state.gender);
    const status = typeof getTeamStatus === "function"
      ? getTeamStatus({ teamId: state.schoolId, sport: state.sport, gender: state.gender })
      : { overall: "—", conference: "—", standing: "Not posted", conferenceName: "Conference" };

    const logoEl = dialog.querySelector("#teamDetailLogo");
    logoEl.innerHTML = state.logo
      ? `<img src="${state.logo}" alt="${school.subtitle || school.name} logo" referrerpolicy="no-referrer" />`
      : `<span>${school.short || "★"}</span>`;
    dialog.querySelector("#teamDetailSchool").textContent = school.name;
    dialog.querySelector("#teamDetailMascot").textContent = `${school.subtitle || ""}${school.subtitle ? " · " : ""}${sportLabel(state.sport, state.gender)}`;

    dialog.querySelector("#teamDetailSports").innerHTML = groups.map(group =>
      `<button type="button" class="team-detail-sport${group.key === active.key ? " active" : ""}" data-sport="${group.sport}" data-gender="${group.gender}">${sportLabel(group.sport, group.gender)}</button>`
    ).join("");

    dialog.querySelector("#teamDetailStatus").innerHTML = `
      <div class="team-detail-stat"><small>Overall</small><strong>${status.overall}</strong></div>
      <div class="team-detail-stat"><small>Conference</small><strong>${status.conference}</strong></div>
      <div class="team-detail-stat"><small>Standing</small><strong>${status.standing}<br><span style="font-size:.66rem;color:var(--pitch-muted)">${status.conferenceName}</span></strong></div>`;

    const source = selectedEvents.find(e => e.sourceUrl)?.sourceUrl || "";
    const sourceLink = dialog.querySelector("#teamDetailSource");
    sourceLink.href = source || "#";
    sourceLink.hidden = !source;

    dialog.querySelector("#teamDetailSchedule").innerHTML = selectedEvents.length
      ? selectedEvents.map(event => `<div class="team-detail-game">
          <div><strong>${event.home ? "vs." : "at"} ${event.opponent}</strong><div class="meta">${displayDate(event.date)} · ${event.venue}${event.notes ? ` · ${event.notes}` : ""}</div></div>
          <div class="team-detail-home">${event.home ? "Home" : "Away"}</div>
        </div>`).join("")
      : `<div class="team-detail-empty">No schedule loaded for this sport yet.</div>`;
  }

  function openFromTrigger(trigger) {
    state.schoolId = trigger.dataset.teamId;
    state.sport = trigger.dataset.sport;
    state.gender = trigger.dataset.gender || "";
    const image = trigger.querySelector("img");
    state.logo = image && !image.hidden ? image.src : "";
    renderDetail();
    const dialog = ensureDialog();
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("click", event => {
    const trigger = event.target.closest(".team-detail-trigger");
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      openFromTrigger(trigger);
      return;
    }
    const sport = event.target.closest(".team-detail-sport");
    if (sport) {
      state.sport = sport.dataset.sport;
      state.gender = sport.dataset.gender || "";
      renderDetail();
    }
  });
})();