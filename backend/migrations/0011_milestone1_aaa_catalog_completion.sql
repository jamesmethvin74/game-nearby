PRAGMA foreign_keys = ON;

-- Milestone 1 inventory completion only.
-- AAA/DragonFly organization IDs are the identity authority for this certified set.
-- This migration deliberately creates no sources, schedules, games, records, or standings.
-- Persistent D1 work is bounded to four set-based DML statements regardless of row count.

CREATE VIEW IF NOT EXISTS _m1_aaa_catalog_seed AS
SELECT
  json_extract(value,'$.aaa_id') AS aaa_id,
  json_extract(value,'$.school_name') AS school_name,
  json_extract(value,'$.team_codes') AS team_codes
FROM json_each('[{"aaa_id":"C36ASB","school_name":"ACORN HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"6KM4QU","school_name":"ARK. SCHOOL FOR THE DEAF & BLIND H.S.","team_codes":["MBB","WBB"]},{"aaa_id":"NWWK4Z","school_name":"Arkansas High School","team_codes":["FB","MBB","MSO","WBB","WSO","WVB"]},{"aaa_id":"AK6FWG","school_name":"Armorel High School","team_codes":["MBB","WBB"]},{"aaa_id":"9DWQEG","school_name":"AUGUSTA HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"PAUJ7M","school_name":"BAY HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"F5BMWJ","school_name":"BEARDEN HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"V6MDNM","school_name":"BIGELOW HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"V775T6","school_name":"Bismarck High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"VE2K8D","school_name":"Blevins High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"3QBPWE","school_name":"BRADFORD HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"EZ9X2W","school_name":"BRADLEY HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"BE6ELE","school_name":"BRINKLEY HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"H95NCZ","school_name":"Buffalo Island Central High School","team_codes":["MBB","MSO","WBB","WSO"]},{"aaa_id":"PN87NY","school_name":"CADDO HILLS HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"SLJGHX","school_name":"CALICO ROCK HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"6UBY3P","school_name":"CARLISLE HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"YGAV2L","school_name":"Catholic High School For Boys","team_codes":["FB","MBB","MSO"]},{"aaa_id":"9539DM","school_name":"Cedarville High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"BNCUR7","school_name":"Centerpoint High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"3RV89E","school_name":"Clarendon High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"79SKPH","school_name":"CONCORD HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"XRL8NL","school_name":"COUNTY LINE HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"5F3YHB","school_name":"Cross County High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"G6QWXW","school_name":"Crossett High School","team_codes":["FB","MBB","MSO","WBB","WSO"]},{"aaa_id":"6XA4LA","school_name":"DANVILLE HIGH SCHOOL","team_codes":["FB","MBB","MSO","WBB","WSO"]},{"aaa_id":"LMVKJS","school_name":"DEER K-12 SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"ZBQF4U","school_name":"Delta Preparatory Schools Blytheville","team_codes":["MBB"]},{"aaa_id":"PV6QUZ","school_name":"DEQUEEN HIGH SCHOOL","team_codes":["FB","MBB","MSO","WBB","WSO"]},{"aaa_id":"4974GD","school_name":"DERMOTT HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"BVL6X2","school_name":"DES ARC HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"CTKGCW","school_name":"DeWitt High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"P6DP36","school_name":"DIERKS HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"XFXSGQ","school_name":"DREW CENTRAL HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"FHFFM4","school_name":"Dumas High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"ULLT9D","school_name":"EARLE HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"6LEVPU","school_name":"EAST POINSETT CO. HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"7HMZ7C","school_name":"eStem High School","team_codes":["MBB","WBB"]},{"aaa_id":"7QEE96","school_name":"FAYETTEVILLE CHRISTIAN SCHOOL","team_codes":["MBB"]},{"aaa_id":"S6BA6T","school_name":"FORDYCE HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"RP6YZQ","school_name":"Forest City High School","team_codes":["FB"]},{"aaa_id":"CZWXQP","school_name":"FOUKE HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"JKHDAK","school_name":"Glen Rose High School 7-12","team_codes":["FB","MBB","WBB"]},{"aaa_id":"EHA64G","school_name":"GOSNELL HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"ZMHVLY","school_name":"Gospel Light Christian School","team_codes":["MBB","WBB"]},{"aaa_id":"8MUWMY","school_name":"GREENLAND HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"2QZD2Q","school_name":"GURDON HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"6NHFSM","school_name":"Haas Hall Academy - Bentonville","team_codes":["MBB","MSO","WBB","WSO"]},{"aaa_id":"KKNGN2","school_name":"HAAS HALL ACADEMY Rogers","team_codes":["MBB"]},{"aaa_id":"JP55L3","school_name":"HALL HIGH SCHOOL– West SOI","team_codes":["MBB","WBB"]},{"aaa_id":"ASLQVP","school_name":"HAMBURG HIGH SCHOOL","team_codes":["FB","MBB","MSO","WBB","WSO"]},{"aaa_id":"X396KS","school_name":"HAMPTON HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"BAPPNV","school_name":"HAZEN HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"ZGPVLC","school_name":"HERMITAGE HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"CJYQLC","school_name":"HILLCREST HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"4PPKE4","school_name":"HOPE HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"E426QU","school_name":"Horatio High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"XJ4QTB","school_name":"JASPER HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"2CQYEH","school_name":"Junction City High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"RSCLM3","school_name":"KINGSTON HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"TXNUHV","school_name":"Lakeside High School (Lake Village)","team_codes":["FB","MBB","MSO","WBB","WSO"]},{"aaa_id":"D3QCQW","school_name":"LEAD HILL HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"QTG924","school_name":"Lee Academy","team_codes":["WBB"]},{"aaa_id":"C2EE5G","school_name":"Legacy Academy","team_codes":["MBB","WBB"]},{"aaa_id":"FEREXU","school_name":"Mansfield High School","team_codes":["FB"]},{"aaa_id":"WQPLDR","school_name":"MARKED TREE HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"ZEMDYN","school_name":"MARMADUKE HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"Y7MRH7","school_name":"MARVELL ACADEMY","team_codes":["WBB"]},{"aaa_id":"AGKHEY","school_name":"MARVELL-ELAINE HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"PSZ7KC","school_name":"MAYNARD HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"UT4WXY","school_name":"MCCRORY HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"ABVJV7","school_name":"McGehee High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"5E794S","school_name":"Monticello High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"G5N2R9","school_name":"Mount Ida High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"M85AW5","school_name":"MOUNT VERNON/ENOLA HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"CVTNH9","school_name":"MOUNTAIN VIEW HIGH SCHOOL","team_codes":["FB","MBB","MSO","WBB","WSO"]},{"aaa_id":"FYZ9E7","school_name":"MT. JUDEA K-12 SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"4Q6JWQ","school_name":"MURFREESBORO HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"LWDSHK","school_name":"NASHVILLE HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"TJDVAR","school_name":"OARK HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"9RQZS6","school_name":"ODEN SCHOOLS","team_codes":["MBB","WBB"]},{"aaa_id":"ZHC63N","school_name":"OSCEOLA HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"U72RHS","school_name":"OUACHITA HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"CTKL54","school_name":"OZARK ADVENTIST ACADEMY","team_codes":["MBB"]},{"aaa_id":"KZMC87","school_name":"Ozark Mountain High School","team_codes":["MBB","WBB"]},{"aaa_id":"3DAKJS","school_name":"PANGBURN HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"LVNRNE","school_name":"Parkers Chapel High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"K5KPG3","school_name":"PINE BLUFF HIGH SCHOOL","team_codes":["FB","MBB","MSO","WBB","WSO"]},{"aaa_id":"H9RJMJ","school_name":"Poyen High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"RWG2EF","school_name":"PRESCOTT HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"U4PHHM","school_name":"RECTOR HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"W4FT74","school_name":"RISON HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"NCMJWZ","school_name":"RURAL SPECIAL HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"NSEKYC","school_name":"SACRED HEART CATHOLIC SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"9MWYAA","school_name":"School for Advanced Studies-NW Arkansas","team_codes":["MBB","WBB"]},{"aaa_id":"NYLQRF","school_name":"Scranton High School","team_codes":["MBB","WBB"]},{"aaa_id":"VRTB7W","school_name":"SHIRLEY HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"BUFSNZ","school_name":"SLOAN-HENDRIX HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"PTZW9N","school_name":"ST. PAUL HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"GZBRUP","school_name":"STAR CITY HIGH SCHOOL","team_codes":["FB","MBB","WBB"]},{"aaa_id":"GBEW3S","school_name":"Strong-Huttig High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"JBWEFE","school_name":"Subiaco Academy","team_codes":["FB","MBB"]},{"aaa_id":"N7TZK3","school_name":"TIMBO HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"K4KHL3","school_name":"TUCKERMAN HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"SL6PRJ","school_name":"UMPIRE K-12 SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"U96M34","school_name":"Warren High School","team_codes":["FB","MBB","WBB"]},{"aaa_id":"54Y79F","school_name":"WEST SIDE HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"BAZ2QB","school_name":"WESTERN YELL CO. HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"AP5PK9","school_name":"WHITE CO. CENTRAL HIGH SCHOOL","team_codes":["MBB","WBB"]},{"aaa_id":"TJ94GM","school_name":"Wonderview High School","team_codes":["MBB","WBB"]},{"aaa_id":"CRUFAS","school_name":"WOODLAWN HIGH SCHOOL","team_codes":["FB","MBB","WBB"]}]');

-- Only create a new canonical school when this AAA identity is not already mapped.
-- aaa-* IDs avoid the df-* unverified-opponent trigger because these rows are AAA-certified.
INSERT OR IGNORE INTO schools
  (id,name,city,state,level,catalog_scope,membership_source,membership_verified_at)
SELECT
  'aaa-' || lower(seed.aaa_id),
  seed.school_name,
  '',
  'AR',
  'high-school',
  'local',
  'aaa-certified',
  CURRENT_TIMESTAMP
FROM _m1_aaa_catalog_seed seed
WHERE NOT EXISTS (
  SELECT 1
  FROM school_external_identities identity
  WHERE identity.provider='dragonfly'
    AND identity.external_school_id=seed.aaa_id
);

-- Preserve any identity mapping that may have appeared since the certified checkpoint.
INSERT OR IGNORE INTO school_external_identities
  (provider,external_school_id,school_id,observed_name,last_seen_at,updated_at)
SELECT
  'dragonfly',
  seed.aaa_id,
  'aaa-' || lower(seed.aaa_id),
  seed.school_name,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM _m1_aaa_catalog_seed seed;

-- AAA certification is allowed to promote an already-known DragonFly identity to local.
-- The WHERE clause keeps the clean-checkpoint path at zero UPDATE writes.
UPDATE schools
SET catalog_scope='local',
    state='AR',
    level='high-school',
    membership_source='aaa-certified',
    membership_verified_at=CURRENT_TIMESTAMP,
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (
  SELECT identity.school_id
  FROM school_external_identities identity
  JOIN _m1_aaa_catalog_seed seed
    ON seed.aaa_id=identity.external_school_id
  WHERE identity.provider='dragonfly'
)
AND (
  catalog_scope<>'local'
  OR state<>'AR'
  OR level<>'high-school'
  OR COALESCE(membership_source,'')<>'aaa-certified'
);

-- Establish only the 2026 varsity team inventory. No schedule/source rows are created.
WITH sport_map(code,sport,gender,id_slug) AS (
  VALUES
    ('FB','football','boys','football'),
    ('MBB','basketball','boys','boys-basketball'),
    ('WBB','basketball','girls','girls-basketball'),
    ('MSO','soccer','boys','boys-soccer'),
    ('WSO','soccer','girls','girls-soccer'),
    ('WVB','volleyball','girls','volleyball')
)
INSERT OR IGNORE INTO teams
  (id,school_id,sport,gender,season,conference_id,active)
SELECT
  identity.school_id || '-' || sport_map.id_slug || '-2026',
  identity.school_id,
  sport_map.sport,
  sport_map.gender,
  '2026',
  NULL,
  1
FROM _m1_aaa_catalog_seed seed
JOIN school_external_identities identity
  ON identity.provider='dragonfly'
 AND identity.external_school_id=seed.aaa_id
JOIN json_each(seed.team_codes) team_code
JOIN sport_map
  ON sport_map.code=team_code.value;

DROP VIEW IF EXISTS _m1_aaa_catalog_seed;
