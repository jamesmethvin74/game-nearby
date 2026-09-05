PRAGMA foreign_keys = ON;

-- Official-school final-result source bootstrap.
--
-- Purpose:
--   Keep DragonFly/other authority for schedule timing where appropriate, while
--   adding school-operated Mascot Media pages as an independent FINAL-result
--   observation source for football, volleyball, boys basketball and girls
--   basketball.
--
-- Safety:
--   * source rows only; no games/results are collected by this migration
--   * no deletes or destructive updates
--   * school identity is resolved through certified DragonFly/AAA identities
--   * existing Mascot Media sources are preserved and not duplicated
--
-- Production execution of this migration remains a separately-approved D1 step.

CREATE VIEW IF NOT EXISTS _official_result_mascot_sites AS
SELECT
  json_extract(value,'$.aaa_id') AS aaa_id,
  json_extract(value,'$.base_url') AS base_url
FROM json_each('[
  {"aaa_id":"HNHRP8","base_url":"https://www.conwaywampuscats.com"},
  {"aaa_id":"SE48QJ","base_url":"https://www.greenbrierathletics.com"},
  {"aaa_id":"YF5Y8Q","base_url":"https://www.viloniaathletics.com"},
  {"aaa_id":"7RXKJC","base_url":"https://www.gobentonvilletigers.com"},
  {"aaa_id":"KQ5HLR","base_url":"https://www.cabotpanthers.com"},
  {"aaa_id":"2TR733","base_url":"https://www.bryantathletics.com"},
  {"aaa_id":"BQP5SF","base_url":"https://www.fhsbulldogs.com"}
]');

CREATE VIEW IF NOT EXISTS _official_result_mascot_targets AS
SELECT
  t.id AS team_id,
  t.school_id,
  t.sport,
  t.gender,
  t.season,
  site.base_url,
  CASE
    WHEN t.sport='football' AND t.gender='boys'
      THEN site.base_url || '/sport/football/boys/?tab=schedule'
    WHEN t.sport='volleyball' AND t.gender='girls'
      THEN site.base_url || '/sport/volleyball/girls/?tab=schedule'
    WHEN t.sport='basketball' AND t.gender='boys'
      THEN site.base_url || '/sport/basketball/boys/?tab=schedule'
    WHEN t.sport='basketball' AND t.gender='girls'
      THEN site.base_url || '/sport/basketball/girls/?tab=schedule'
  END AS source_url,
  CASE
    WHEN t.sport='football' THEN 5
    WHEN t.sport='volleyball' THEN 8
    WHEN t.sport='basketball' THEN 10
    ELSE 1
  END AS expected_min_games
FROM _official_result_mascot_sites site
JOIN school_external_identities identity
  ON identity.provider='dragonfly'
 AND identity.external_school_id=site.aaa_id
JOIN teams t
  ON t.school_id=identity.school_id
WHERE t.active=1
  AND t.season='2026'
  AND (
    (t.sport='football' AND t.gender='boys') OR
    (t.sport='volleyball' AND t.gender='girls') OR
    (t.sport='basketball' AND t.gender IN ('boys','girls'))
  );

INSERT INTO sources
  (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,
   timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,
   authority_rank,stale_after_minutes,created_at,updated_at)
SELECT
  target.team_id || '-official-school-results',
  target.team_id,
  target.source_url,
  'official-school',
  2,
  'mascot-media',
  '2',
  'America/Chicago',
  target.expected_min_games,
  360,
  120,
  1,
  20,
  1440,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM _official_result_mascot_targets target
WHERE target.source_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sources existing
    WHERE existing.team_id=target.team_id
      AND existing.parser_type='mascot-media'
      AND rtrim(existing.source_url,'/')=rtrim(target.source_url,'/')
  );

DROP VIEW IF EXISTS _official_result_mascot_targets;
DROP VIEW IF EXISTS _official_result_mascot_sites;
