import { buildScheduledAt, cleanText, parseMonthDay, parseResult, stableKeys } from "./parser-core.js";

function calendarYearForDate(dateText, season) {
  const startYear = Number(season);
  if (!Number.isInteger(startYear)) throw new Error(`Invalid college season ${season}`);
  const parsed = parseMonthDay(dateText, String(startYear));
  if (!parsed) return null;
  // College basketball seasons span two calendar years. August-December belong
  // to the season start year; January-July belong to the following year.
  return String(parsed.month <= 7 ? startYear + 1 : startYear);
}

function isHomeLocation(location, source) {
  const city = cleanText(source.school_city);
  const state = cleanText(source.school_state);
  if (!city) return false;
  const value = cleanText(location).toLowerCase();
  if (!value) return false;
  if (value.includes(city.toLowerCase())) return !state || value.includes(state.toLowerCase());
  return false;
}

export function normalizeInstitutionalScheduleRows(rows, source) {
  const events = [];
  for (const raw of rows || []) {
    const cells = (raw.cells || []).map(cleanText);
    const dateText = cells[0] || cleanText(raw.date);
    const opponent = cells[1] || cleanText(raw.opponent);
    const location = cells[2] || cleanText(raw.location);
    const timeText = cells[3] || cleanText(raw.time);
    const resultText = cells[4] || cleanText(raw.result);
    if (!dateText || !opponent || /^(opponent|team)$/i.test(opponent)) continue;

    const calendarYear = calendarYearForDate(dateText, source.season);
    if (!calendarYear) continue;
    const schedule = buildScheduledAt(`${dateText} ${timeText}`, calendarYear, source.timezone || "America/Chicago");
    if (!schedule) continue;

    // Multi-day postseason placeholders are not discrete games and should not
    // be written as observations until an actual opponent/game is published.
    if (/\b(tournament|district championship|national championship)\b/i.test(opponent) && /\d+\s*[-–]\s*\d+/.test(dateText)) continue;

    const homeAway = isHomeLocation(location, source) ? "home" : (location ? "away" : "unknown");
    const parsed = parseResult(resultText);
    const full = cleanText(cells.join(" | "));
    const nonCount = /\b(jamboree|scrimmage|exhibition)\b/i.test(full);

    events.push({
      nativeId: raw.nativeId || "",
      opponent,
      scheduledAt: schedule.scheduledAt,
      scheduledTimeKnown: schedule.timeKnown,
      venue: location,
      locationText: location,
      latitude: null,
      longitude: null,
      homeAway,
      conferenceGame: 0,
      countsForRecord: nonCount ? 0 : 1,
      ...parsed,
      notes: nonCount ? (full.match(/\b(Jamboree|Scrimmage|Exhibition)\b/i)?.[0] || "") : ""
    });
  }
  return stableKeys(events);
}
