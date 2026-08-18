function applyHomeAwayStyles() {
  document.querySelectorAll('.event-card').forEach(card => {
    const main = card.querySelector('.event-main');
    if (!main) return;
    const text = main.textContent || '';
    const isAway = /\bat\s+/i.test(text) && !/\bvs\.?\s+/i.test(text);
    card.classList.toggle('away-game', isAway);
    card.classList.toggle('home-game', !isAway);

    if (!card.querySelector('.home-away-badge')) {
      const badge = document.createElement('span');
      badge.className = 'home-away-badge';
      badge.textContent = isAway ? 'AWAY' : 'HOME';
      const title = card.querySelector('.event-title');
      if (title && title.parentElement) title.parentElement.insertBefore(badge, title.nextSibling);
    } else {
      card.querySelector('.home-away-badge').textContent = isAway ? 'AWAY' : 'HOME';
    }
  });
}

const homeAwayObserver = new MutationObserver(applyHomeAwayStyles);
homeAwayObserver.observe(document.body, { childList: true, subtree: true });
applyHomeAwayStyles();
