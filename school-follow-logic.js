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

renderTeamChoices = function() {
  teamChoicesEl.innerHTML = SCHOOL_REGISTRY.map(school => {
    const count = events.filter(e => isUpcoming(e) && (e.schoolIds || [e.teamId]).includes(school.id)).length;
    return `<label class="team-choice"><span><strong>${school.name}</strong><small style="display:block;color:var(--muted);margin-top:3px">${school.subtitle} · ${count} upcoming event${count===1?"":"s"}</small></span><input type="checkbox" value="${school.id}" ${followed.includes(school.id)?"checked":""}></label>`;
  }).join("");
};

render = function() {
  const radius = Number(radiusEl.value);
  const visible = events
    .filter(isUpcoming)
    .map(e => ({...e, distance:haversineMiles(center,e)}))
    .filter(e => e.distance <= radius && matchesFilter(e))
    .sort((a,b) => new Date(a.date)-new Date(b.date) || a.distance-b.distance);

  // Feature only the next matching game for each followed school.
  // Every other visible event stays in "Other Games Nearby", even if it
  // belongs to a followed school. This matches the original app concept.
  const priority = featuredEventsFor(visible);
  const featuredIds = new Set(priority.map(e => e.id));
  const others = visible.filter(e => !featuredIds.has(e.id));

  followedEventsEl.innerHTML = priority.length
    ? priority.map(e => eventCard(e,true)).join("")
    : `<div class="empty">No followed schools have upcoming games inside ${radius} miles.</div>`;

  renderFollowedPager(priority.length);

  otherEventsEl.innerHTML = others.length
    ? others.map(e => eventCard(e)).join("")
    : `<div class="empty">No other upcoming games match these filters.</div>`;

  resultCountEl.textContent = `${others.length} event${others.length===1?"":"s"}`;
};

render();