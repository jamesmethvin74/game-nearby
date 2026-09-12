const TIME_ZONE = "America/Chicago";

function localParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid collection cadence timestamp");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = type => parts.find(part => part.type === type)?.value || "";
  return {
    weekday: read("weekday"),
    month: Number(read("month")),
    hour: Number(read("hour")),
    minute: Number(read("minute"))
  };
}

function plan(kind, options = {}) {
  const liveStatewideSports = [...new Set(Array.isArray(options.liveStatewideSports) ? options.liveStatewideSports : [])];
  if (options.runVolleyballLive && !liveStatewideSports.includes("volleyball-girls")) liveStatewideSports.push("volleyball-girls");
  return {
    kind,
    runStatewide: Boolean(options.runStatewide),
    // Retained for compatibility with the existing volleyball fallback path;
    // generic live polling is driven by liveStatewideSports.
    runVolleyballLive: liveStatewideSports.includes("volleyball-girls"),
    liveStatewideSports,
    runCore: Boolean(options.runCore),
    runCatalogMaintenance: Boolean(options.runCatalogMaintenance),
    scope: options.scope || "all",
    activeResultMinutes: Number(options.activeResultMinutes || 0) || null
  };
}

function liveSportKeys({ volleyballSeason, basketballSeason }) {
  const keys = [];
  if (volleyballSeason) keys.push("volleyball-girls");
  if (basketballSeason) keys.push("basketball-boys", "basketball-girls");
  return keys;
}

export function collectionPlanAt(value = new Date()) {
  const { weekday, month, hour, minute } = localParts(value);
  const volleyballSeason = month >= 8 && month <= 11;
  // Arkansas basketball can begin before November. Start cheap semantic probes
  // in October so boys/girls result ingestion is already warm when games ramp up.
  const basketballSeason = month >= 10 || month <= 3;

  // Weekly maintenance is intentionally isolated from ordinary result polling.
  if (weekday === "Sun" && hour === 4 && minute === 0) {
    return plan("weekly-catalog-maintenance", {
      runStatewide: true,
      runCatalogMaintenance: true,
      scope: "catalog"
    });
  }

  // Friday high-school/football result window: 8:30 PM Friday through 1:00 AM
  // Saturday Central. Seasonal statewide probes piggyback without changing the
  // football-scoped official-source cadence.
  const fridayEvening = weekday === "Fri" && (
    (hour === 20 && minute === 30) ||
    (hour >= 21 && hour <= 23 && (minute === 0 || minute === 30))
  );
  const fridayLate = weekday === "Sat" && (
    (hour === 0 && (minute === 0 || minute === 30)) ||
    (hour === 1 && minute === 0)
  );
  if (fridayEvening || fridayLate) {
    return plan("friday-football-results", {
      liveStatewideSports: liveSportKeys({ volleyballSeason, basketballSeason }),
      runCore: true,
      scope: "football-game-day",
      activeResultMinutes: 30
    });
  }

  // In-season statewide live probes run every 30 minutes on weekday evenings.
  // The probes are semantic/read-only when the provider payload is unchanged;
  // only an actual feed change invokes the existing certified collector.
  const weekdayEvening = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) && (
    (hour === 16 && minute === 30) ||
    (hour >= 17 && hour <= 22 && (minute === 0 || minute === 30))
  );
  const eveningLiveKeys = liveSportKeys({ volleyballSeason, basketballSeason });
  if (weekdayEvening && eveningLiveKeys.length) {
    const volleyballOnly = eveningLiveKeys.length === 1 && eveningLiveKeys[0] === "volleyball-girls";
    return plan(volleyballOnly ? "volleyball-live-results" : "statewide-live-results", {
      liveStatewideSports: eveningLiveKeys,
      scope: volleyballOnly ? "volleyball-statewide" : "statewide-live-results"
    });
  }

  // Saturday is the college-heavy live-update day. Keep the existing 30-minute
  // college source polling. Basketball statewide probes run every tick in season;
  // fall volleyball remains hourly during tournament season.
  const saturdayCollege = weekday === "Sat" && (
    (hour === 10 && minute === 30) ||
    (hour >= 11 && hour <= 23 && (minute === 0 || minute === 30))
  );
  const saturdayLate = weekday === "Sun" && (
    (hour === 0 && (minute === 0 || minute === 30)) ||
    (hour === 1 && minute === 0)
  );
  if (saturdayCollege || saturdayLate) {
    const liveStatewideSports = [];
    if (volleyballSeason && minute === 0) liveStatewideSports.push("volleyball-girls");
    if (basketballSeason) liveStatewideSports.push("basketball-boys", "basketball-girls");
    return plan("saturday-college-results", {
      liveStatewideSports,
      runCore: true,
      scope: "college-game-day",
      activeResultMinutes: 30
    });
  }

  if (minute === 0 && hour === 6) {
    return plan("morning-results", {
      runStatewide: true,
      runCore: true,
      scope: "all"
    });
  }

  if (minute === 0 && hour === 15) {
    return plan("afternoon-schedule-check", {
      runStatewide: true,
      runCore: true,
      scope: "all"
    });
  }

  if (minute === 0 && hour === 23) {
    return plan("evening-results", {
      runStatewide: true,
      runCore: true,
      scope: "all"
    });
  }

  return null;
}

export { TIME_ZONE, liveSportKeys };
