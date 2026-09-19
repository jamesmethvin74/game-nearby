function sportSvg(sport){
  const common='viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if(sport==="football") return `<svg ${common}><path d="M12 34c-6-6-5-16 2-23 7-7 17-8 23-2s5 16-2 23-17 8-23 2Z"/><path d="M16 30 32 14"/><path d="m20 24 4 4m0-8 4 4m0-8 4 4"/></svg>`;
  if(sport==="basketball") return `<svg ${common}><circle cx="24" cy="24" r="16"/><path d="M8 24h32M24 8v32M12.7 13.2c6 4.7 8.8 10.9 8.5 18.6M35.3 34.8c-6-4.7-8.8-10.9-8.5-18.6"/></svg>`;
  if(sport==="volleyball") return `<svg ${common}><circle cx="24" cy="24" r="16"/><path d="M24 8c4.5 5 6.3 10 5.4 15M8.5 20c6.7-1.8 12-.7 16 3.3M15 37c1.4-6.6 5-11 10.8-13.3M39 27c-6.7 1.1-11.8-.4-15.5-4.5"/></svg>`;
  if(sport==="soccer") return `<svg ${common}><circle cx="24" cy="24" r="16"/><path d="m24 17 6 4-2 7h-8l-2-7 6-4ZM24 8v9M9.5 19l8.5 2M14 35l6-7M34 35l-6-7M38.5 19 30 21"/></svg>`;
  return `<svg ${common}><circle cx="24" cy="24" r="15"/><path d="M18 24h12M24 18v12"/></svg>`;
}

function recordLabel(w=0,l=0,t=0){
  const wins=Number(w)||0, losses=Number(l)||0, ties=Number(t)||0;
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function getTeamStatus(event){
  const unified = event?.presentationStatus || window.LocalBleachersLive?.getPresentationStatus?.(event.teamId, event.sport, event.gender);
  const factual = window.LocalBleachersPresentation?.teamStatus?.(unified);
  if (factual) return factual;
  const requiresPresentationTruth = event?.level === "high-school"
    && ["football","volleyball","basketball"].includes(String(event?.sport || "").toLowerCase());
  if (requiresPresentationTruth) {
    return {
      overall:"—",
      conference:"—",
      standing:"—",
      conferenceName:event.conferenceName || "Conference"
    };
  }

  const record = event.record || null;
  if (record) {
    const conferenceGames = Number(record.conference_wins || 0) + Number(record.conference_losses || 0) + Number(record.conference_ties || 0);
    const rank = Number(record.rank);
    return {
      overall: recordLabel(record.wins, record.losses, record.ties),
      conference: record.conference_name ? recordLabel(record.conference_wins, record.conference_losses, record.conference_ties) : "—",
      standing: record.conference_name && conferenceGames > 0 && Number.isFinite(rank) && rank > 0 ? `#${rank}` : "—",
      conferenceName: record.conference_name || event.conferenceName || "Conference not available"
    };
  }
  return { overall:"—", conference:"—", standing:"—", conferenceName:"Conference not available" };
}

function polishedSourceLabel(event){
  if(event.source!=="official") return "Schedule source";
  if(event.teamId==="uca") return "UCA Athletics";
  if(event.teamId==="hendrix") return "Hendrix Athletics";
  if(event.teamId==="cbc") return "CBC Athletics";
  if(event.teamId==="conway") return "Conway Athletics";
  return "Official schedule";
}

eventCard = function(event,priority=false){
  const dist=haversineMiles(center,event);
  const matchup=`${event.home?"vs.":"at"} ${event.opponent}`;
  const locationClass=event.home?"home-game":"away-game";
  const locationLabel=event.home?"HOME":"AWAY";
  const status=getTeamStatus(event);
  const ticket=event.ticketUrl ? `<a class="ticket-action" href="${event.ticketUrl}" target="_blank" rel="noopener">Tickets</a>` : "";
  const genderLabel=event.gender ? `${capitalize(event.gender)} ` : "";
  return `<article class="event-card ${priority?"priority ":""}${locationClass}">
    <div class="event-main">
      <div class="team-badge">${badgeFor(event.teamId)}</div>
      <div>
        <div class="event-title">${event.team}</div>
        <div class="matchup-line"><span class="home-away-badge">${locationLabel}</span>${genderLabel}${capitalize(event.sport)} · ${matchup}</div>
        <div class="event-meta">${formatEventDate(event.date)} · ${event.venue}${event.notes?` · ${event.notes}`:""}</div>
        <div class="event-meta source-row"><a href="${event.sourceUrl}" target="_blank" rel="noopener">${polishedSourceLabel(event)}</a></div>
      </div>
      <div class="sport-mark">
        <div class="sport-icon" title="${capitalize(event.sport)}">${sportSvg(event.sport)}</div>
        <div class="distance">${dist.toFixed(1)} mi</div>
      </div>
    </div>
    <div class="team-status">
      <div class="status-cell"><span class="status-label">Overall</span><span class="status-value">${status.overall}</span></div>
      <div class="status-cell"><span class="status-label">Conference</span><span class="status-value">${status.conference}</span></div>
      <div class="status-cell"><span class="status-label">Standing</span><span class="status-value conference">${status.standing} · ${status.conferenceName}</span></div>
    </div>
    <div class="event-actions"><a href="${directionsUrl(event)}" target="_blank" rel="noopener">Directions</a>${ticket}<a href="${calendarUrl(event)}" target="_blank" rel="noopener">Calendar</a></div>
  </article>`;
};

render();