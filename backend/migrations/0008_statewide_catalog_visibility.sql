PRAGMA foreign_keys = ON;

-- Statewide-managed identities that have not been verified as Arkansas schools stay
-- internal/opponent-only. Verified local teams receive normal DragonFly authority.
UPDATE sources
SET authority_rank = 99
WHERE collection_mode = 'statewide';

CREATE TRIGGER IF NOT EXISTS trg_statewide_team_scope_updates_source_authority
AFTER UPDATE OF active ON teams
BEGIN
  UPDATE sources
  SET authority_rank = CASE WHEN NEW.active = 1 THEN 10 ELSE 99 END,
      updated_at = NEW.updated_at
  WHERE team_id = NEW.id AND collection_mode = 'statewide';
END;

CREATE TRIGGER IF NOT EXISTS trg_statewide_source_scope_on_insert
AFTER INSERT ON sources
WHEN NEW.collection_mode = 'statewide'
BEGIN
  UPDATE sources
  SET authority_rank = CASE
      WHEN (SELECT active FROM teams WHERE id = NEW.team_id) = 1 THEN 10
      ELSE 99
    END
  WHERE id = NEW.id;
END;
