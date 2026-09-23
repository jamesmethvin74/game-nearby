PRAGMA foreign_keys = ON;

-- Official-school final-result source catalog, batch 3.
-- Generated from backend/src/official-school-source-catalog.js.
-- Scope: volleyball + boys/girls basketball only. No football/baseball.
-- Source-only: this migration does not collect games or mutate canonical events.

WITH verified_aliases(site_key,school_name,city,state,base_url,parser_type) AS (
  VALUES
  ('farmington','Farmington','Farmington','AR','https://www.farmcardsathletics.org','mascot-media'),
  ('farmington','Farmington High School','Farmington','AR','https://www.farmcardsathletics.org','mascot-media'),
  ('morrilton','Morrilton','Morrilton','AR','https://www.morriltonathletics.com','mascot-media'),
  ('morrilton','Morrilton High School','Morrilton','AR','https://www.morriltonathletics.com','mascot-media'),
  ('gravette','Gravette','Gravette','AR','https://www.gravetteathletics.net','mascot-media'),
  ('gravette','Gravette High School','Gravette','AR','https://www.gravetteathletics.net','mascot-media'),
  ('gentry','Gentry','Gentry','AR','https://www.gentryathletics.com','mascot-media'),
  ('gentry','Gentry High School','Gentry','AR','https://www.gentryathletics.com','mascot-media'),
  ('cutter-morning-star','Cutter Morning Star','Hot Springs','AR','https://www.cmseaglesathletics.com','mascot-media'),
  ('cutter-morning-star','Cutter-Morning Star','Hot Springs','AR','https://www.cmseaglesathletics.com','mascot-media'),
  ('cutter-morning-star','Cutter Morning Star High School','Hot Springs','AR','https://www.cmseaglesathletics.com','mascot-media')
),
verified_sites AS (
  SELECT site_key,city,state,base_url,parser_type,
         json_group_array(school_name) AS school_names_json
  FROM verified_aliases
  GROUP BY site_key,city,state,base_url,parser_type
),
matched_schools AS (
  SELECT DISTINCT
    site.site_key,site.base_url,site.parser_type,sch.id AS school_id
  FROM verified_sites site
  JOIN schools sch
    ON lower(trim(COALESCE(sch.city,'')))=lower(trim(site.city))
   AND upper(trim(COALESCE(sch.state,'')))=upper(trim(site.state))
  WHERE EXISTS (
    SELECT 1
    FROM json_each(site.school_names_json) alias
    WHERE lower(trim(alias.value))=lower(trim(sch.name))
  )
),
targets AS (
  SELECT
    t.id AS team_id,
    t.sport,
    t.gender,
    site.base_url,
    site.parser_type,
    CASE
      WHEN t.sport='volleyball' AND t.gender='girls'
        THEN site.base_url || '/sport/volleyball/girls/?tab=schedule'
      WHEN t.sport='basketball' AND t.gender='boys'
        THEN site.base_url || '/sport/basketball/boys/?tab=schedule'
      WHEN t.sport='basketball' AND t.gender='girls'
        THEN site.base_url || '/sport/basketball/girls/?tab=schedule'
    END AS source_url,
    CASE WHEN t.sport='volleyball' THEN 8 ELSE 10 END AS expected_min_games
  FROM matched_schools site
  JOIN teams t ON t.school_id=site.school_id
  WHERE t.active=1
    AND t.season='2026'
    AND (
      (t.sport='volleyball' AND t.gender='girls') OR
      (t.sport='basketball' AND t.gender IN ('boys','girls'))
    )
)
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
  target.parser_type,
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
FROM targets target
WHERE target.source_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sources existing
    WHERE existing.team_id=target.team_id
      AND existing.source_type='official-school'
      AND existing.parser_type=target.parser_type
      AND rtrim(existing.source_url,'/')=rtrim(target.source_url,'/')
  );
