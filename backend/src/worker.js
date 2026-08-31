import core from "./index.js";
import { syncDragonFlyVarsityVolleyballCatalog } from "./dragonfly-discovery.js";
import { runDragonFlyStatewideCollection } from "./dragonfly-statewide.js";

let liveConfigReady = false;

async function ensureLiveConfig(env) {
  if (liveConfigReady) return;

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO schools(id,name,city,state,level,mascot,latitude,longitude,updated_at)
      VALUES('greenbrier','Greenbrier High School','Greenbrier','AR','high-school','Panthers',35.2334,-92.3870,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=excluded.city,state=excluded.state,level=excluded.level,mascot=excluded.mascot,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO schools(id,name,city,state,level,mascot,latitude,longitude,updated_at)
      VALUES('vilonia','Vilonia High School','Vilonia','AR','high-school','Eagles',35.0839,-92.2029,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=excluded.city,state=excluded.state,level=excluded.level,mascot=excluded.mascot,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,source_url,updated_at)
      VALUES('6a-central-volleyball','6A Central','6A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball',?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,classification=excluded.classification,source_url=excluded.source_url,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,source_url,updated_at)
      VALUES('5a-central-volleyball','5A Central','5A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball',?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,classification=excluded.classification,source_url=excluded.source_url,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('uca-volleyball-2026','uca','volleyball','women','2026','uac',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='uac',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('conway-volleyball-2026','conway','volleyball','girls','2026','6a-central-volleyball',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='6a-central-volleyball',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('greenbrier-volleyball-2026','greenbrier','volleyball','girls','2026','5a-central-volleyball',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='5a-central-volleyball',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('vilonia-volleyball-2026','vilonia','volleyball','girls','2026','5a-central-volleyball',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='5a-central-volleyball',active=1,updated_at=excluded.updated_at
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
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('greenbrier-volleyball-official','greenbrier-volleyball-2026','https://www.greenbrierathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Greenbrier High School',35.2334,-92.3870,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('vilonia-volleyball-official','vilonia-volleyball-2026','https://www.viloniaathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Vilonia High School',35.0839,-92.2029,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now)
  ]);

  liveConfigReady = true;
}

export default {
  async fetch(request, env, ctx) {
    await ensureLiveConfig(env);
    return core.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    await ensureLiveConfig(env);
    let catalogPayload=null;
    try {
      const catalog=await syncDragonFlyVarsityVolleyballCatalog(env);
      catalogPayload=catalog.payload||null;
      const {payload,...summary}=catalog;
      console.log("statewide volleyball catalog",summary);
    } catch (error) {
      console.error("statewide volleyball catalog sync failed",error);
    }

    try {
      const statewide=await runDragonFlyStatewideCollection(env,{payload:catalogPayload});
      console.log("statewide volleyball collection",statewide);
    } catch (error) {
      console.error("statewide volleyball collection failed",error);
    } finally {
      // Statewide sources are storage/health identities for the bulk collector. Keeping them
      // disabled prevents the legacy per-team collector from walking the same statewide feed
      // hundreds of times. Existing proven team-mode sources remain enabled.
      await env.DB.prepare("UPDATE sources SET enabled=0 WHERE collection_mode='statewide'").run();
    }

    return core.scheduled(controller, env, ctx);
  }
};
