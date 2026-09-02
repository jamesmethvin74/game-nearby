const TIME_ZONE = "America/Chicago";

function localParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid collection cadence timestamp");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = type => parts.find(part => part.type === type)?.value || "";
  return {
    weekday: read("weekday"),
    hour: Number(read("hour")),
    minute: Number(read("minute"))
  };
}

function plan(kind, options = {}) {
  return {
    kind,
    runStatewide: Boolean(options.runStatewide),
    runCore: Boolean(options.runCore),
    runCatalogMaintenance: Boolean(options.runCatalogMaintenance),
    scope: options.scope || "all"
  };
}

export function collectionPlanAt(value = new Date()) {
  const { weekday, hour, minute } = localParts(value);

  // Weekly maintenance is intentionally isolated from ordinary result polling.
  if (weekday === "Sun" && hour === 4 && minute === 0) {
    return plan("weekly-catalog-maintenance", {
      runStatewide: true,
      runCatalogMaintenance: true,
      scope: "catalog"
    });
  }

  // Friday football: 8:30 PM through midnight Central, every 30 minutes.
  // Midnight belongs to Saturday on the clock but is the final Friday-night pass.
  const fridayEvening = weekday === "Fri" && (
    (hour === 20 && minute === 30) ||
    (hour >= 21 && hour <= 23 && (minute === 0 || minute === 30))
  );
  const fridayMidnight = weekday === "Sat" && hour === 0 && minute === 0;
  if (fridayEvening || fridayMidnight) {
    return plan("friday-football-results", {
      runCore: true,
      scope: "football"
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
