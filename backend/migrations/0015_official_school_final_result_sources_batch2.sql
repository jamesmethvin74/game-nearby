PRAGMA foreign_keys = ON;

-- Official-school final-result source catalog, batch 2.
-- Source-only expansion: no game/result collection is performed here.

CREATE VIEW IF NOT EXISTS _official_result_mascot_sites_b2 AS
SELECT
  json_extract(value,'$.aaa_id') AS aaa_id,
  json_extract(value,'$.base_url') AS base_url
FROM json_each('[
  {"aaa_id":"WD92V5","base_url":"https://www.almaairedales.com"},
  {"aaa_id":"D8JJ4R","base_url":"https://www.arkadelphiabadgertv.com"},
  {"aaa_id":"S7358S","base_url":"https://www.gobentonvillewestwolverines.com"},
  {"aaa_id":"KTPGZC","base_url":"https://www.boonevillebearcats.com"},
  {"aaa_id":"YGAV2L","base_url":"https://www.chsrockets.com"},
  {"aaa_id":"8PKUD7","base_url":"https://www.huntsvilleathletics.com"},
  {"aaa_id":"DXGR8R","base_url":"https://www.mhbombersports.com"},
  {"aaa_id":"LWDSHK","base_url":"https://www.scrappersports.com"},
  {"aaa_id":"HRDB8F","base_url":"https://www.chargingwildcatathletics.com"},
  {"aaa_id":"JBCLSD","base_url":"https://www.lrparkviewathletics.com"},
  {"aaa_id":"7X4SXH","base_url":"https://www.pearidgeathletics.com"},
  {"aaa_id":"QG2ANT","base_url":"https://www.rogersmounties.com"},
  {"aaa_id":"BF8ZXN","base_url":"https://www.gowareagles.com"},
  {"aaa_id":"BKC4UX","base_url":"https://www.lrsouthwestathletics.com"}
]');

CREATE VIEW IF NOT EXISTS _official_result_mascot_targets_b2 AS
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
FROM _official_result_mascot_sites_b2 site
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

INSERT OR IGNORE INTO sources
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
FROM _official_result_mascot_targets_b2 target
WHERE target.source_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sources existing
    WHERE existing.team_id=target.team_id
      AND existing.parser_type='mascot-media'
      AND rtrim(existing.source_url,'/')=rtrim(target.source_url,'/')
  );

DROP VIEW IF EXISTS _official_result_mascot_targets_b2;
DROP VIEW IF EXISTS _official_result_mascot_sites_b2;
