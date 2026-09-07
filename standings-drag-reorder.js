(() => {
  const FAVORITES_KEY = "localBleachersAR:standings:favorites";
  const LONG_PRESS_MS = 340;
  const SCROLL_CANCEL_PX = 10;
  const grid = document.getElementById("favoriteStandingsGrid");
  if (!grid) return;

  let gesture = null;
  let suppressClickUntil = 0;

  function favoriteKey(item) {
    return `${String(item?.sport || "").trim()}::${String(item?.conferenceId || "").trim()}`;
  }

  function cardKey(card) {
    return card?.querySelector("[data-favorite-open]")?.dataset.favoriteOpen || "";
  }

  function readFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function broadcastFavorites(value) {
    try {
      window.dispatchEvent(new StorageEvent("storage", {
        key: FAVORITES_KEY,
        newValue: JSON.stringify(value),
        storageArea: localStorage
      }));
    } catch {
      window.dispatchEvent(new Event("storage"));
    }
  }

  function saveDomOrder() {
    const current = readFavorites();
    const byKey = new Map(current.map(item => [favoriteKey(item), item]));
    const visibleKeys = [...grid.querySelectorAll(".favorite-standings-card")]
      .map(cardKey)
      .filter(Boolean);
    const ordered = visibleKeys.map(key => byKey.get(key)).filter(Boolean);
    const visibleSet = new Set(visibleKeys);
    current.forEach(item => {
      if (!visibleSet.has(favoriteKey(item))) ordered.push(item);
    });
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ordered)); }
    catch { return; }
    broadcastFavorites(ordered);
  }

  function clearTimer() {
    if (gesture?.timer) clearTimeout(gesture.timer);
    if (gesture) gesture.timer = null;
  }

  function cleanup(save = false) {
    if (!gesture) return;
    clearTimer();
    const { card, ghost, active } = gesture;
    if (ghost?.isConnected) ghost.remove();
    card?.classList.remove("is-dragging", "is-drag-placeholder");
    grid.classList.remove("is-reordering");
    document.body.classList.remove("standings-touch-reorder-active");
    if (active) {
      suppressClickUntil = Date.now() + 650;
      if (save) saveDomOrder();
    }
    gesture = null;
  }

  function startDrag() {
    if (!gesture || gesture.active || !gesture.card?.isConnected) return;
    const rect = gesture.card.getBoundingClientRect();
    const ghost = gesture.card.cloneNode(true);
    ghost.classList.remove("active");
    ghost.classList.add("favorite-standings-drag-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);

    gesture.active = true;
    gesture.ghost = ghost;
    gesture.card.classList.add("is-dragging", "is-drag-placeholder");
    grid.classList.add("is-reordering");
    document.body.classList.add("standings-touch-reorder-active");
    suppressClickUntil = Date.now() + 650;
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function findTouch(event) {
    if (!gesture) return null;
    return [...event.touches, ...event.changedTouches]
      .find(touch => touch.identifier === gesture.touchId) || null;
  }

  function moveCardAt(clientY) {
    if (!gesture?.active) return;
    const cards = [...grid.querySelectorAll(".favorite-standings-card")]
      .filter(card => card !== gesture.card);
    let target = null;
    let before = false;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        target = card;
        before = clientY < rect.top + rect.height / 2;
        break;
      }
    }

    if (!target) {
      const first = cards[0];
      const last = cards[cards.length - 1];
      if (first && clientY < first.getBoundingClientRect().top) {
        target = first;
        before = true;
      } else if (last && clientY > last.getBoundingClientRect().bottom) {
        target = last;
        before = false;
      }
    }

    if (!target) return;
    const reference = before ? target : target.nextSibling;
    if (reference !== gesture.card) grid.insertBefore(gesture.card, reference);
  }

  grid.addEventListener("touchstart", event => {
    if (event.touches.length !== 1 || gesture) return;
    if (event.target.closest("[data-favorite-remove]")) return;
    const card = event.target.closest(".favorite-standings-card");
    if (!card || !cardKey(card)) return;
    const touch = event.touches[0];
    gesture = {
      card,
      touchId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      active: false,
      ghost: null,
      timer: setTimeout(startDrag, LONG_PRESS_MS)
    };
  }, { passive: true });

  grid.addEventListener("touchmove", event => {
    const touch = findTouch(event);
    if (!touch || !gesture) return;
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;

    if (!gesture.active) {
      if (Math.hypot(dx, dy) > SCROLL_CANCEL_PX) {
        clearTimer();
        gesture = null;
      }
      return;
    }

    event.preventDefault();
    if (gesture.ghost) {
      gesture.ghost.style.transform = `translate3d(0, ${dy}px, 0) scale(1.015)`;
    }
    moveCardAt(touch.clientY);
  }, { passive: false });

  grid.addEventListener("touchend", event => {
    if (!gesture || !findTouch(event)) return;
    cleanup(true);
  }, { passive: true });

  grid.addEventListener("touchcancel", () => cleanup(true), { passive: true });

  grid.addEventListener("contextmenu", event => {
    if (event.target.closest(".favorite-standings-card")) event.preventDefault();
  });

  grid.addEventListener("click", event => {
    if (Date.now() < suppressClickUntil && event.target.closest(".favorite-standings-card")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
