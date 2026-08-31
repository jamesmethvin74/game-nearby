PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO conferences (id,name,classification,standings_method,coverage_complete,source_url) VALUES
 ('6a-central-volleyball','6A Central','6A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball'),
 ('5a-central-volleyball','5A Central','5A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball');

UPDATE teams
SET conference_id='6a-central-volleyball', updated_at=CURRENT_TIMESTAMP
WHERE id='conway-volleyball-2026';

INSERT OR IGNORE INTO schools (id,name,city,state,level,mascot,latitude,longitude) VALUES
 ('greenbrier','Greenbrier High School','Greenbrier','AR','high-school','Panthers',35.2334,-92.3870),
 ('vilonia','Vilonia High School','Vilonia','AR','high-school','Eagles',35.0839,-92.2029);

INSERT OR IGNORE INTO teams (id,school_id,sport,gender,season,conference_id) VALUES
 ('greenbrier-volleyball-2026','greenbrier','volleyball','girls','2026','5a-central-volleyball'),
 ('vilonia-volleyball-2026','vilonia','volleyball','girls','2026','5a-central-volleyball');

INSERT OR IGNORE INTO sources
 (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude)
VALUES
 ('greenbrier-volleyball-official','greenbrier-volleyball-2026','https://www.greenbrierathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Greenbrier High School',35.2334,-92.3870),
 ('vilonia-volleyball-official','vilonia-volleyball-2026','https://www.viloniaathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Vilonia High School',35.0839,-92.2029);
