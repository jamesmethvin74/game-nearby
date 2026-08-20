(() => {
  const MASCOTS = {
    uca: { icon: "🐻", label: "Bears", className: "uca", mark: "assets/team-uca.webp" },
    conway: { icon: "🐯", label: "Wampus Cats", className: "conway", mark: "assets/team-conway.webp" },
    greenbrier: { icon: "🐆", label: "Panthers", className: "greenbrier", mark: "assets/team-greenbrier.webp" },
    vilonia: { icon: "🦅", label: "Eagles", className: "vilonia" },
    hendrix: { icon: "⚔", label: "Warriors", className: "hendrix" },
    cbc: { icon: "🐎", label: "Mustangs", className: "cbc" },
    mayflower: { icon: "🦅", label: "Eagles", className: "mayflower" },
    maumelle: { icon: "🐝", label: "Hornets", className: "maumelle" },
    morrilton: { icon: "Ⓜ", label: "Devil Dogs", className: "morrilton", mark: "assets/team-morrilton.webp" }
  };
  const compactDate = (iso) => new Date(iso).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"});
  const sameLocalDate = (a,b) => a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  const timingLabel = (event) => {const date=new Date(event.date),today=new Date();if(sameLocalDate(date,today))return "GAME TODAY";const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);if(sameLocalDate(date,tomorrow))return "GAME TOMORROW";return "NEXT GAME";};
  const mascotBadge = (event) => {const mascot=MASCOTS[event.teamId];if(!mascot)return `<div class="team-badge">${badgeFor(event.teamId)}</div>`;if(mascot.mark)return `<div class="team-badge team-mascot mascot-${mascot.className}"><img class="team-mark-img" src="${mascot.mark}" alt="${mascot.label} logo" /></div>`;return `<div class="team-badge team-mascot mascot-${mascot.className}" role="img" aria-label="${mascot.label} mascot">${mascot.icon}</div>`;};
  const statusFor = (event) => typeof getTeamStatus==="function"?getTeamStatus(event):{overall:"—",conference:"—",standing:"Not posted",conferenceName:"Conference"};
  const miniStatus = (status) => `<div class="mini-status" aria-label="Team record and standing"><span>${status.overall} overall</span><span>${status.conference} conf.</span><span>${status.standing}</span></div>`;

  eventCard = function(event, priority=false){
    const dist=haversineMiles(center,event),matchup=`${event.home?"vs.":"at"} ${event.opponent}`,locationClass=event.home?"home-game":"away-game";
    const ticket=event.ticketUrl?`<a class="ticket-action" href="${event.ticketUrl}" target="_blank" rel="noopener">🎟 Tickets</a>`:"";
    const genderLabel=event.gender?`${capitalize(event.gender)} `:"";
    const source=typeof polishedSourceLabel==="function"?polishedSourceLabel(event):sourceLabel(event),status=statusFor(event);
    if(!priority){return `<article class="event-card ${locationClass}"><div class="event-main">${mascotBadge(event)}<div><div class="event-title">${event.team}</div><div class="matchup-line">${genderLabel}${capitalize(event.sport)} · ${matchup}</div><div class="event-meta">◷ ${compactDate(event.date)} <span class="venue-dot">•</span> ⌖ ${event.venue}</div>${miniStatus(status)}</div><div class="compact-distance">${dist.toFixed(1)} mi<span class="compact-chevron">›</span></div></div></article>`;}
    return `<article class="event-card priority ${locationClass}"><span class="game-label">${timingLabel(event)}</span><div class="event-main">${mascotBadge(event)}<div><div class="event-title">${event.team}</div><div class="matchup-line">${genderLabel}${capitalize(event.sport)} · ${matchup}</div><div class="event-meta">◷ ${compactDate(event.date)} <span class="venue-dot">•</span> ⌖ ${event.venue}${event.notes?` · ${event.notes}`:""}</div><div class="event-meta source-row"><a href="${event.sourceUrl}" target="_blank" rel="noopener">${source}</a></div></div><div class="compact-distance">${dist.toFixed(1)} mi<span class="compact-chevron">›</span></div></div><div class="team-status" aria-label="Record and standings"><div class="status-cell"><span class="status-label">Overall</span><span class="status-value">${status.overall}</span></div><div class="status-cell"><span class="status-label">Conference</span><span class="status-value">${status.conference}</span></div><div class="status-cell"><span class="status-label">Standing</span><span class="status-value conference">${status.standing} · ${status.conferenceName}</span></div></div><div class="event-actions"><a href="${directionsUrl(event)}" target="_blank" rel="noopener">🚗 Directions</a>${ticket}<a href="${calendarUrl(event)}" target="_blank" rel="noopener">▦ Add to Calendar</a></div></article>`;
  };
  render();
})();
