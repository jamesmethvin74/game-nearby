const OPPONENT_SCHOOL_MAP = [
  ["central baptist", "cbc"],
  ["cbc", "cbc"],
  ["university of central arkansas", "uca"],
  ["uca", "uca"],
  ["hendrix", "hendrix"],
  ["conway", "conway"],
  ["greenbrier", "greenbrier"],
  ["vilonia", "vilonia"],
  ["mayflower", "mayflower"],
  ["maumelle", "maumelle"]
];

function opponentSchoolId(opponent) {
  const value = String(opponent || "").toLowerCase();
  const match = OPPONENT_SCHOOL_MAP.find(([needle]) => value.includes(needle));
  return match ? match[1] : null;
}

for (const event of events) {
  const opponentId = opponentSchoolId(event.opponent);
  event.schoolIds = [...new Set([event.teamId, opponentId].filter(Boolean))];
}

function isFollowedSchoolEvent(event) {
  const ids = event.schoolIds || [event.teamId];
  return ids.some(id => followed.includes(id));
}

function featuredEventsFor(visible) {
  const featured = [];
  const usedEventIds = new Set();

  for (const schoolId of followed) {
    const nextForSchool = visible.find(event => {
      const ids = event.schoolIds || [event.teamId];
      return ids.includes(schoolId) && !usedEventIds.has(event.id);
    });
    if (!nextForSchool) continue;
    featured.push(nextForSchool);
    usedEventIds.add(nextForSchool.id);
  }

  return featured;
}

function renderFollowedPager(count) {
  let pager = document.querySelector("#followedPager");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "followedPager";
    pager.className = "followed-pager";
    followedEventsEl.insertAdjacentElement("afterend", pager);
  }

  if (count <= 1) {
    pager.hidden = true;
    pager.innerHTML = "";
    followedEventsEl.onscroll = null;
    return;
  }

  pager.hidden = false;
  pager.innerHTML = Array.from({length:count}, (_,index) =>
    `<button type="button" class="followed-dot${index===0?" active":""}" aria-label="Show featured game ${index+1}"></button>`
  ).join("");

  const dots = [...pager.querySelectorAll(".followed-dot")];
  const activate = index => dots.forEach((dot,i) => dot.classList.toggle("active", i===index));

  dots.forEach((dot,index) => dot.addEventListener("click", () => {
    const cards = [...followedEventsEl.querySelectorAll(".event-card.priority")];
    const card = cards[index];
    if (card) followedEventsEl.scrollTo({left:card.offsetLeft-followedEventsEl.offsetLeft, behavior:"smooth"});
  }));

  followedEventsEl.onscroll = () => {
    const cards = [...followedEventsEl.querySelectorAll(".event-card.priority")];
    if (!cards.length) return;
    const left = followedEventsEl.scrollLeft;
    let closestIndex = 0;
    let closestDistance = Infinity;
    cards.forEach((card,index) => {
      const distance = Math.abs((card.offsetLeft-followedEventsEl.offsetLeft)-left);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    activate(closestIndex);
  };
}

function schoolChoiceDetail(school) {
  const parts = [];
  if (school.subtitle) parts.push(school.subtitle);
  const place = [school.city, school.state].filter(Boolean).join(", ");
  if (place && !parts.includes(place)) parts.push(place);
  if (Number(school.teamCount || 0) > 0) {
    const count = Number(school.teamCount);
    parts.push(`${count} active team${count === 1 ? "" : "s"}`);
  }
  return parts.join(" · ") || "Arkansas school";
}

function ensureTeamSearchStyle() {
  if (document.querySelector("#teamSearchFilterStyle")) return;
  const style = document.createElement("style");
  style.id = "teamSearchFilterStyle";
  style.textContent = `.team-choice.team-choice-filtered{display:none!important}.team-search-wrap{position:sticky;top:0;z-index:3;background:var(--pitch-surface,var(--card,#10243d));padding:0 0 10px}.team-search-input{width:100%;box-sizing:border-box;border:1px solid var(--pitch-line,var(--line,#35506b));border-radius:12px;padding:12px 14px;background:var(--pitch-surface-soft,var(--bg-soft,#0b1d31));color:var(--pitch-ink,inherit);font:inherit;outline:none}.team-search-input:focus{border-color:var(--pitch-blue,var(--blue,#4da3ff));box-shadow:0 0 0 2px color-mix(in srgb,var(--pitch-blue,var(--blue,#4da3ff)) 18%,transparent)}`;
  document.head.appendChild(style);
}

function filterTeamChoices(search, choices) {
  const needle = String(search?.value || "").trim().toLowerCase();
  for (const choice of choices) {
    const haystack = String(choice.dataset.teamSearch || "").toLowerCase();
    choice.classList.toggle("team-choice-filtered", Boolean(needle) && !haystack.includes(needle));
  }
}

renderTeamChoices = function() {
  if (typeof SCHOOL_REGISTRY === "undefined" || !SCHOOL_REGISTRY.length) {
    teamChoicesEl.innerHTML = `<div class="empty">Loading Arkansas schools…</div>`;
    return;
  }

  ensureTeamSearchStyle();
  const rows = SCHOOL_REGISTRY.map(school => {
    const searchText = `${school.name} ${school.providerName || ""} ${school.subtitle || ""} ${school.city || ""} ${school.state || ""}`.toLowerCase();
    return `<label class="team-choice" data-team-search="${searchText.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}"><span><strong>${school.name}</strong><small style="display:block;color:var(--muted);margin-top:3px">${schoolChoiceDetail(school)}</small></span><input type="checkbox" value="${school.id}" ${followed.includes(school.id)?"checked":""}></label>`;
  }).join("");

  teamChoicesEl.innerHTML = `<div class="team-search-wrap"><input id="teamSearchInput" class="team-search-input" type="search" autocomplete="off" placeholder="Search Arkansas schools" aria-label="Search Arkansas schools"></div>${rows}`;

  const search = teamChoicesEl.querySelector("#teamSearchInput");
  const choices = [...teamChoicesEl.querySelectorAll(".team-choice")];
  const apply = () => filterTeamChoices(search, choices);
  search?.addEventListener("input", apply);
  search?.addEventListener("search", apply);
};

function homeEventSource() {
  const live = window.LocalBleachersLive?.getNearbyEvents?.();
  return Array.isArray(live) && live.length ? live : events;
}

render = function() {
  const radius = Number(radiusEl.value);
  const visible = homeEventSource()
    .filter(isUpcoming)
    .filter(isFollowedSchoolEvent)
    .map(e => ({...e, distance:haversineMiles(center,e)}))
    .filter(e => e.distance <= radius && matchesFilter(e))
    .sort((a,b) => new Date(a.date)-new Date(b.date) || a.distance-b.distance);

  // Home is personal: only games involving schools the user explicitly follows.
  // The first upcoming game for each followed school is featured; additional
  // games for those same followed schools appear below it.
  const priority = featuredEventsFor(visible);
  const featuredIds = new Set(priority.map(e => e.id));
  const others = visible.filter(e => !featuredIds.has(e.id));

  followedEventsEl.innerHTML = priority.length
    ? priority.map(e => eventCard(e,true)).join("")
    : `<div class="empty">No followed schools have upcoming games inside ${radius} miles.</div>`;

  renderFollowedPager(priority.length);

  otherEventsEl.innerHTML = others.length
    ? others.map(e => eventCard(e)).join("")
    : `<div class="empty">No additional games from your followed schools match these filters.</div>`;

  resultCountEl.textContent = `${others.length} event${others.length===1?"":"s"}`;
};

const otherHeading = otherEventsEl?.closest("section")?.querySelector("h2");
if (otherHeading) otherHeading.textContent = "More from your teams";

render();