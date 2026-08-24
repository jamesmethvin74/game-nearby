INSERT OR IGNORE INTO teams (id,school_id,sport,gender,season,conference_id) VALUES
 ('uca-volleyball-2026','uca','volleyball','women','2026','uac'),
 ('conway-volleyball-2026','conway','volleyball','girls','2026','7a-central');

INSERT OR IGNORE INTO sources
 (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude)
VALUES
 ('uca-volleyball-official','uca-volleyball-2026','https://ucasports.com/sports/womens-volleyball/schedule/2026','official-athletics',1,'sidearm','1','America/Chicago',20,360,60,'Prince Center',35.0817,-92.4576),
 ('conway-volleyball-official','conway-volleyball-2026','https://www.conwaywampuscats.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',8,360,60,'Buzz Bolding Arena',35.0887,-92.4421);
