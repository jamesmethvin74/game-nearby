(() => {
  const MASCOTS = {
    uca: { icon: "🐻", label: "Bears", className: "uca", mark: "assets/team-uca.webp" },
    conway: { icon: "🐯", label: "Wampus Cats", className: "conway", mark: "https://5starassets.blob.core.windows.net/article-photos/2482279/5a127846-cdce-4734-8209-7e28b361eb10_640x480.jpg" },
    greenbrier: { icon: "🐆", label: "Panthers", className: "greenbrier", mark: "https://5starassets.blob.core.windows.net/athleticsites/2484829/273/images/1a83fa41-fdc1-47c8-9594-8b4884c167c8.png" },
    vilonia: { icon: "🦅", label: "Eagles", className: "vilonia", mark: "https://cmsv2-assets.apptegy.net/uploads/27614/logo/30427/Vilonia_School_District_AR_logo.png" },
    hendrix: { icon: "⚔", label: "Warriors", className: "hendrix", mark: "https://dxbhsrqyrr690.cloudfront.net/sidearm.nextgen.sites/hendrix.sidearmsports.com/images/responsive_2023/logo_main.png" },
    cbc: { icon: "🐎", label: "Mustangs", className: "cbc", mark: "https://static.wixstatic.com/media/c13f88_4bfbbeb6499d408e86dfae8d386843fd~mv2.png/v1/fill/w_1844%2Ch_1391%2Cal_c/CBC%20MustangHeadRGB.png" },
    mayflower: { icon: "🦅", label: "Eagles", className: "mayflower", mark: "https://cmsv2-assets.apptegy.net/uploads/8151/file/2478643/ed1774ac-7cfb-4020-9b46-13ad2f6a77b4.png" },
    maumelle: { icon: "🐝", label: "Hornets", className: "maumelle", mark: "https://3290e177b2fd5f573818-64f3acf27ad03d71638c9614decd2d36.ssl.cf1.rackcdn.com/article/image/large_f944a35a-5c3d-4a03-9b29-e149a444cc25.png" },
    morrilton: { icon: "Ⓜ", label: "Devil Dogs", className: "morrilton", mark: "https://5starassets.blob.core.windows.net/article-photos/2484894/6B78332D565A552A1FF8D9B8613ADBCC.png" }
  };
  const compactDate = (iso) => new Date(iso).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"});
  const sameLocalDate = (a,b) => a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  const timingLabel = (event) => {const date=new Date(event.date),today=new Date();if(sameLocalDate(date,today))return "GAME TODAY";const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);if(sameLocalDate(date,tomorrow))return "GAME TOMORROW";return "NEXT GAME";};
  const mascotBadge = (event) => {
    const mascot=MASCOTS[event.teamId];
    if(!mascot)return `<button type="button" class="team-badge team-detail-trigger" data-team-id="${event.teamId}" data-sport="${event.sport}" data-gender="${event.gender||""}" aria-label="Open ${event.team} details">${badgeFor(event.teamId)}</button>`;
    if(mascot.mark)return `<button type="button" class="team-badge team-mascot mascot-${mascot.className} team-detail-trigger" data-team-id="${event.teamId}" data-sport="${event.sport}" data-gender="${event.gender||""}" aria-label="Open ${event.team} details"><img class="team-mark-img" src="${mascot.mark}" alt="${mascot.label} logo" referrerpolicy="no-referrer" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span class="team-mark-fallback" role="img" aria-label="${mascot.label} mascot" hidden>${mascot.icon}</span></button>`;
    return `<button type="button" class="team-badge team-mascot mascot-${mascot.className} team-detail-trigger" data-team-id="${event.teamId}" data-sport="${event.sport}" data-gender="${event.gender||""}" aria-label="Open ${event.team} details"><span role="img" aria-label="${mascot.label} mascot">${mascot.icon}</span></button>`;
  };
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