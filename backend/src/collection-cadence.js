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
  return {
    kind,
    runStatewide: Boolean(options.runStatewide),
    runVolleyballLive: Boolean(options.runVolleyballLive),
    runCore: Boolean(options.runCore),
    runCatalogMaintenance: Boolean(options.runCatalogMaintenance),
    scope: options.scope || "all",
    activeResultMinutes: Number(options.activeResultMinutes || 0) || null
  };
}

export function collectionPlanAt(value = new Date()) {
  const { weekday, month, hour, minute } = localParts(value);
  const volleyballSeason = month >= 8 && month <= 11;

  // Weekly maintenance is intentionally isolated from ordinary result polling.
  if (weekday === "Sun" && hour === 4 && minute === 0) {
    return plan("weekly-catalog-maintenance", {
      runStatewide: true,
      runCatalogMaintenance: true,
      scope: "catalog"
    });
  }

  // Friday high-school/football result window: 8:30 PM Friday through 1:00 AM
  // Saturday Central. During fall volleyball season the same cron tick also
  // performs the cheap statewide semantic probe.
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
      runVolleyballLive: volleyballSeason,
      runCore: true,
      scope: "football-game-day",
      activeResultMinutes: 30
    });
  }

  // Volleyball is in-season across the work week. Probe the one statewide
  // DragonFly varsity feed every 30 minutes from 4:30 PM through 10:30 PM.
  // The probe itself performs no D1 writes unless the semantic feed changes.
  const volleyballWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  const volleyballEvening = volleyballSeason && volleyballWeekday && (
    (hour === 16 && minute === 30) ||
    (hour >= 17 && hour <= 22 && (minute === 0 || minute === 30))
  );
  if (volleyballEvening) {
    return plan("volleyball-live-results", {
      runVolleyballLive: true,
      scope: "volleyball-statewide"
    });
  }

  // Saturday is the college-heavy live-update day. Keep the existing 30-minute
  // college source polling, while checking statewide volleyball hourly during
  // fall tournament season. No catalog/GIS/branding maintenance runs here.
  const saturdayCollege = weekday === "Sat" && (
    (hour === 10 && minute === 30) ||
    (hour >= 11 && hour <= 23 && (minute === 0 || minute === 30))
  );
  const saturdayLate = weekday === "Sun" && (
    (hour === 0 && (minute === 0 || minute === 30)) ||
    (hour === 1 && minute === 0)
  );
  if (saturdayCollege || saturdayLate) {
    return plan("saturday-college-results", {
      runVolleyballLive: volleyballSeason && minute === 0,
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

export { TIME_ZONE };
