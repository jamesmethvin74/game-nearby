import { normalizeSchoolAlias } from "./schedule-authority-core.js";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function participantName(participant = {}) {
  return clean(participant.name || participant.schoolName || participant.displayName);
}

function eventId(raw = {}) {
  return clean(raw.eventId || raw.id || raw.gameId || raw.contestId || raw.uuid);
}

function collectParticipantEvents(value, out = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectParticipantEvents(item, out, seen);
    return out;
  }
  if (eventId(value) && Array.isArray(value.participants) && value.participants.length >= 2) out.push(value);
  for (const nested of Object.values(value)) if (nested && typeof nested === "object") collectParticipantEvents(nested, out, seen);
  return out;
}

export function attachDragonFlyOpponentIdentities(payload, source, events = []) {
  const reporter = normalizeSchoolAlias(source?.school_name);
  if (!reporter || !Array.isArray(events) || !events.length) return events;
  const opponentByEvent = new Map();

  for (const raw of collectParticipantEvents(payload)) {
    const id = eventId(raw);
    if (!id) continue;
    const reportingParticipant = raw.participants.find(participant => normalizeSchoolAlias(participantName(participant)) === reporter);
    if (!reportingParticipant) continue;
    const opponent = raw.participants.find(participant => participant !== reportingParticipant && participantName(participant));
    const externalSchoolId = clean(opponent?.orgShortCode);
    if (externalSchoolId) opponentByEvent.set(id, externalSchoolId);
  }

  return events.map(event => {
    const externalSchoolId = opponentByEvent.get(clean(event?.nativeId));
    return externalSchoolId
      ? { ...event, opponentProvider:"dragonfly", opponentExternalSchoolId:externalSchoolId }
      : event;
  });
}
