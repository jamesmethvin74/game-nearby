import core from "./index.js";

let pilotConfigReady = false;

async function ensurePilotConfig(env) {
  if (pilotConfigReady) return;
  const state = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM teams WHERE id IN ('uca-volleyball-2026','conway-volleyball-2026')) AS teams,
      (SELECT COUNT(*) FROM sources WHERE id IN ('uca-volleyball-official','conway-volleyball-official')) AS sources
  `).first();
  if (Number(state?.teams || 0) === 2 && Number(state?.sources || 0) === 2) {
    pilotConfigReady = true;
    return;
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('uca-volleyball-2026','uca','volleyball','women','2026','uac',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='uac',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('conway-volleyball-2026','conway','volleyball','girls','2026','7a-central',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='7a-central',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('uca-volleyball-official','uca-volleyball-2026','https://ucasports.com/sports/womens-volleyball/schedule/2026','official-athletics',1,'sidearm','1','America/Chicago',20,360,60,'Prince Center',35.0817,-92.4576,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('conway-volleyball-official','conway-volleyball-2026','https://www.conwaywampuscats.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',8,360,60,'Buzz Bolding Arena',35.0887,-92.4421,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now)
  ]);
  pilotConfigReady = true;
}

export default {
  async fetch(request, env, ctx) {
    await ensurePilotConfig(env);
    return core.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    await ensurePilotConfig(env);
    return core.scheduled(controller, env, ctx);
  }
};
