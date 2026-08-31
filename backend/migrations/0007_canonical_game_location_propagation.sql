PRAGMA foreign_keys = ON;

-- Nearby search reads coordinates from game observations. Schedule Authority V2 stores
-- the authoritative venue point on the canonical event, so every reciprocal observation
-- must inherit that point regardless of which team's observation wins source ordering.
CREATE TRIGGER IF NOT EXISTS trg_games_inherit_canonical_location_insert
AFTER INSERT ON games
WHEN NEW.canonical_event_id IS NOT NULL
BEGIN
  UPDATE games
  SET latitude = COALESCE(
        (SELECT latitude FROM canonical_events WHERE id = NEW.canonical_event_id),
        latitude
      ),
      longitude = COALESCE(
        (SELECT longitude FROM canonical_events WHERE id = NEW.canonical_event_id),
        longitude
      )
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_games_inherit_canonical_location_update
AFTER UPDATE OF canonical_event_id ON games
WHEN NEW.canonical_event_id IS NOT NULL
BEGIN
  UPDATE games
  SET latitude = COALESCE(
        (SELECT latitude FROM canonical_events WHERE id = NEW.canonical_event_id),
        latitude
      ),
      longitude = COALESCE(
        (SELECT longitude FROM canonical_events WHERE id = NEW.canonical_event_id),
        longitude
      )
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_location_propagates_to_games
AFTER UPDATE OF latitude, longitude ON canonical_events
WHEN NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
BEGIN
  UPDATE games
  SET latitude = NEW.latitude,
      longitude = NEW.longitude
  WHERE canonical_event_id = NEW.id;
END;
