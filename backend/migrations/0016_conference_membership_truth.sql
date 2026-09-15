PRAGMA foreign_keys = ON;

-- M9: durable, explicit conference-membership truth.
-- Membership is never inferred from conference names at read time. Every row is
-- either an authoritative member assignment, an explicit independent team, or
-- an explicit unknown state that fails closed until authority evidence exists.
CREATE TABLE IF NOT EXISTS conference_memberships (
  team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  conference_id TEXT REFERENCES conferences(id),
  membership_state TEXT NOT NULL CHECK(membership_state IN ('member','independent','unknown')),
  classification TEXT,
  division TEXT,
  authority_provider TEXT NOT NULL,
  authority_key TEXT,
  source_url TEXT,
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (membership_state='member' AND conference_id IS NOT NULL)
    OR (membership_state IN ('independent','unknown') AND conference_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_conference_memberships_conference_state
  ON conference_memberships(conference_id,membership_state);
CREATE INDEX IF NOT EXISTS idx_conference_memberships_authority
  ON conference_memberships(authority_provider,authority_key);
