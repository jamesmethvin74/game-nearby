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

  const priority = visible.filter(isFollowedSchoolEvent);
  const others = visible.filter(e => !isFollowedSchoolEvent(e));

  followedEventsEl.innerHTML = priority.length
    ? priority.map(e => eventCard(e,true)).join("")
    : `<div class="empty">No followed schools have upcoming games inside ${radius} miles.</div>`;

  otherEventsEl.innerHTML = others.length
    ? others.map(e => eventCard(e)).join("")
    : `<div class="empty">No other upcoming games match these filters.</div>`;

  resultCountEl.textContent = `${visible.length} event${visible.length===1?"":"s"}`;
};

render();
