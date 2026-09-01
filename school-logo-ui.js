(() => {
  const DEFAULT_API_BASE = "https://localbleachersar-sports-api.james-methvin74.workers.dev";
  const API_BASE = String(window.LocalBleachersLive?.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  const logos = new Map();

  const style = document.createElement("style");
  style.id = "schoolMascotLogoStyle";
  style.textContent = `
    .team-badge{position:relative;display:grid;place-items:center;overflow:hidden}
    .team-badge-fallback{display:grid;place-items:center;width:100%;height:100%;font-weight:900}
    .team-badge .school-mascot-logo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;padding:4px;box-sizing:border-box}
    .team-choice{grid-template-columns:46px minmax(0,1fr) auto;align-items:center}
    .team-choice-logo{position:relative;width:42px;height:42px;border-radius:11px;display:grid;place-items:center;overflow:hidden;background:var(--pitch-surface-soft,var(--bg-soft,#0b1d31));border:1px solid var(--pitch-line,var(--line,#35506b));font-size:.8rem;font-weight:900}
    .team-choice-logo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;padding:3px;box-sizing:border-box}
    @media(max-width:520px){.team-choice{grid-template-columns:42px minmax(0,1fr) auto}.team-choice-logo{width:38px;height:38px;border-radius:10px}}
  `;
  document.head.appendChild(style);

  function clean(value) { return String(value ?? "").trim(); }
  function escapeHtml(value) {
    return clean(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function safeLogoUrl(value) {
    const raw = clean(value);
    try {
      const url = new URL(raw);
      return url.protocol === "https:" ? url.toString() : "";
    } catch { return ""; }
  }
  function schoolFor(teamId) {
    return logos.get(teamId)
      || (typeof SCHOOL_REGISTRY !== "undefined" ? SCHOOL_REGISTRY.find(school => school.id === teamId) : null)
      || (typeof teams !== "undefined" ? teams.find(team => team.id === teamId) : null)
      || null;
  }
  function fallbackLabel(teamId) {
    const school = schoolFor(teamId);
    return clean(school?.short || school?.name || teamId).charAt(0).toUpperCase() || "★";
  }
  function badgeMarkup(teamId) {
    const school = schoolFor(teamId);
    const logoUrl = safeLogoUrl(school?.logoUrl || school?.logo_url);
    const fallback = escapeHtml(fallbackLabel(teamId));
    if (!logoUrl) return `<span class="team-badge-fallback">${fallback}</span>`;
    const alt = escapeHtml(`${school?.mascot || school?.name || "School"} logo`);
    return `<span class="team-badge-fallback">${fallback}</span><img class="school-mascot-logo" src="${escapeHtml(logoUrl)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">`;
  }

  function installBadgeRenderer() {
    try { badgeFor = badgeMarkup; } catch { window.badgeFor = badgeMarkup; }
  }

  function decorateRegistry(schools) {
    for (const raw of schools) {
      if (!raw?.id) continue;
      const item = {
        id: raw.id,
        name: clean(raw.location_matched_name || raw.name),
        mascot: clean(raw.mascot),
        logoUrl: safeLogoUrl(raw.logo_url),
        short: clean(raw.location_matched_name || raw.name).charAt(0).toUpperCase() || "★"
      };
      logos.set(raw.id, item);
      if (typeof SCHOOL_REGISTRY !== "undefined") {
        const school = SCHOOL_REGISTRY.find(entry => entry.id === raw.id);
        if (school) Object.assign(school, { mascot:item.mascot || school.mascot, logoUrl:item.logoUrl, short:item.short });
      }
      if (typeof teams !== "undefined") {
        const team = teams.find(entry => entry.id === raw.id);
        if (team) Object.assign(team, { logoUrl:item.logoUrl, mascot:item.mascot || team.mascot });
      }
    }
  }

  function decorateTeamChoices() {
    const root = document.getElementById("teamChoices");
    if (!root) return;
    for (const choice of root.querySelectorAll(".team-choice")) {
      const input = choice.querySelector('input[type="checkbox"]');
      const school = input ? logos.get(input.value) : null;
      if (!school || choice.querySelector(".team-choice-logo")) continue;
      const logoUrl = safeLogoUrl(school.logoUrl);
      const mark = document.createElement("span");
      mark.className = "team-choice-logo";
      mark.innerHTML = logoUrl
        ? `<span>${escapeHtml(school.short)}</span><img src="${escapeHtml(logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">`
        : `<span>${escapeHtml(school.short)}</span>`;
      choice.insertBefore(mark, choice.firstChild);
    }
  }

  async function refresh() {
    const response = await fetch(`${API_BASE}/api/v1/schools`, { headers:{accept:"application/json"}, cache:"no-store" });
    if (!response.ok) throw new Error(`School logo catalog HTTP ${response.status}`);
    const payload = await response.json();
    const schools = Array.isArray(payload?.schools) ? payload.schools : [];
    decorateRegistry(schools);
    installBadgeRenderer();
    decorateTeamChoices();
    if (typeof render === "function") render();
    document.dispatchEvent(new CustomEvent("localbleachers:school-logos", { detail:{ total:schools.length, logos:[...logos.values()].filter(school => school.logoUrl).length } }));
    return logos.size;
  }

  const observer = new MutationObserver(() => decorateTeamChoices());
  const choices = document.getElementById("teamChoices");
  if (choices) observer.observe(choices, { childList:true, subtree:true });

  window.LocalBleachersSchoolLogos = { refresh, get: id => logos.get(id) || null, count: () => [...logos.values()].filter(school => school.logoUrl).length };
  refresh().catch(error => console.warn("School mascot logo refresh failed", error));
})();
