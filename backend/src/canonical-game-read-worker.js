import app from "./team-read-worker.js";

const MAX_SCORES_WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_SCORES_ROWS = 500;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number=Number(value);
  return Number.isFinite(number) ? number : null;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  if (![lat1,lon1,lat2,lon2].every(Number.isFinite)) return null;
  const toRad=value=>value*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 3958.7613*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function resolvedNearbyGame(row) {
  if (!row.canonical_event_id) {
    return {
      ...row,
      conference_game:Number(row.effective_conference_game??row.conference_game??0),
      data_trust:row.data_trust||"SINGLE_SOURCE_LIVE",
      conflict_count:Number(row.conflict_count||0)
    };
  }
  const isHome=row.canonical_home_school_id===row.school_id;
  const isAway=row.canonical_away_school_id===row.school_id;
  const teamScore=isHome?row.canonical_home_score:isAway?row.canonical_away_score:row.team_score;
  const opponentScore=isHome?row.canonical_away_score:isAway?row.canonical_home_score:row.opponent_score;
  const status=row.canonical_status||row.status;
  const result=status==="FINAL" && teamScore!=null && opponentScore!=null
    ? (Number(teamScore)===Number(opponentScore)?"T":Number(teamScore)>Number(opponentScore)?"W":"L")
    : null;
  return {
    ...row,
    id:row.canonical_event_id,
    opponent:isHome?row.canonical_away_name:isAway?row.canonical_home_name:row.opponent,
    scheduled_at:row.canonical_scheduled_at||row.scheduled_at,
    scheduled_time_known:row.canonical_time_known??row.scheduled_time_known,
    venue:row.canonical_venue||row.venue,
    location_text:row.canonical_location_text||row.location_text,
    latitude:row.canonical_latitude??row.latitude,
    longitude:row.canonical_longitude??row.longitude,
    home_away:isHome?"home":isAway?"away":row.home_away,
    status,
    team_score:teamScore,
    opponent_score:opponentScore,
    result,
    conference_game:Number(row.effective_conference_game??row.canonical_conference_game??row.conference_game??0),
    data_trust:row.data_trust||"SINGLE_SOURCE_LIVE",
    conflict_count:Number(row.conflict_count||0)
  };
}

function dateRange(url, { defaultPastHours = 6, defaultFutureDays = 30 } = {}) {
  const now=Date.now();
  const sinceRaw=url.searchParams.get("since");
  const untilRaw=url.searchParams.get("until");
  const since=sinceRaw && Number.isFinite(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : new Date(now-defaultPastHours*3600000).toISOString();
  const until=untilRaw && Number.isFinite(Date.parse(untilRaw)) ? new Date(untilRaw).toISOString() : new Date(now+defaultFutureDays*86400000).toISOString();
  return {since,until};
}

async function nearbyGames(request, env, url) {
  const {since,until}=dateRange(url);
  const hasGeo=url.searchParams.has("lat")&&url.searchParams.has("lon");
  const lat=finiteNumber(url.searchParams.get("lat"));
  const lon=finiteNumber(url.searchParams.get("lon"));
  const radius=Math.max(1,Math.min(500,finiteNumber(url.searchParams.get("radius"))??25));
  const useGeo=hasGeo&&lat!=null&&lon!=null;

  let where="WHERE COALESCE(ce.scheduled_at,g.scheduled_at) BETWEEN ? AND ?";
  const binds=[since,until];
  if (useGeo) {
    const latDelta=radius/69;
    const cos=Math.max(0.15,Math.cos(lat*Math.PI/180));
    const lonDelta=radius/(69*cos);
    where+=" AND COALESCE(ce.latitude,g.latitude) BETWEEN ? AND ? AND COALESCE(ce.longitude,g.longitude) BETWEEN ? AND ?";
    binds.push(lat-latDelta,lat+latDelta,lon-lonDelta,lon+lonDelta);
  }

  const result=await env.DB.prepare(`
    SELECT g.*, t.sport,t.gender,t.season,sch.id AS school_id,sch.name AS school_name,sch.level,sch.mascot,
      c.name AS conference_name,r.wins,r.losses,r.ties,r.conference_wins,r.conference_losses,r.conference_ties,
      src.source_type,src.parser_type,src.authority_rank,src.last_successful_fetch_at AS source_last_successful_fetch_at,
      ce.scheduled_at AS canonical_scheduled_at,ce.scheduled_time_known AS canonical_time_known,ce.venue AS canonical_venue,
      ce.location_text AS canonical_location_text,ce.latitude AS canonical_latitude,ce.longitude AS canonical_longitude,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.conference_game AS canonical_conference_game,ce.trust_state AS data_trust,ce.conflict_count,
      hs.name AS canonical_home_name,aws.name AS canonical_away_name,
      CASE
        WHEN COALESCE(ce.conference_game,g.conference_game)=1 THEN 1
        WHEN t.conference_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM teams ot
          WHERE ot.active=1
            AND ot.school_id=CASE
              WHEN ce.id IS NOT NULL AND ce.home_school_id=t.school_id THEN ce.away_school_id
              WHEN ce.id IS NOT NULL AND ce.away_school_id=t.school_id THEN ce.home_school_id
              ELSE g.opponent_school_id
            END
            AND ot.sport=t.sport
            AND ot.gender=t.gender
            AND ot.season=t.season
            AND ot.conference_id=t.conference_id
        ) THEN 1
        ELSE 0
      END AS effective_conference_game,
      ROW_NUMBER() OVER (PARTITION BY COALESCE(g.canonical_event_id,g.id) ORDER BY src.authority_rank,src.source_priority,src.id) AS authority_row
    FROM games g
    JOIN teams t ON t.id=g.team_id AND t.active=1
    JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local'
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN team_records r ON r.team_id=t.id
    JOIN sources src ON src.id=g.source_id AND src.enabled=1
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id
    LEFT JOIN schools aws ON aws.id=ce.away_school_id
    ${where}
    ORDER BY COALESCE(ce.scheduled_at,g.scheduled_at)
  `).bind(...binds).all();

  let games=(result.results||[])
    .filter(row=>Number(row.authority_row)===1)
    .map(resolvedNearbyGame);
  if (useGeo) {
    games=games.map(game=>({...game,distance_miles:haversineMiles(lat,lon,finiteNumber(game.latitude),finiteNumber(game.longitude))}))
      .filter(game=>game.distance_miles!=null&&game.distance_miles<=radius);
  }
  console.log("canonical nearby read", {
    games:games.length,
    geo:useGeo,
    rowsRead:Number(result.meta?.rows_read||0),
    rowsWritten:Number(result.meta?.rows_written||0)
  });
  return json({games});
}

async function scores(request, env, url) {
  const {since,until}=dateRange(url,{defaultPastHours:12,defaultFutureDays:1});
  const span=Date.parse(until)-Date.parse(since);
  if (!(span>0) || span>MAX_SCORES_WINDOW_MS) return json({error:"scores_window_too_large",max_hours:72},400);
  const sport=String(url.searchParams.get("sport")||"").trim().toLowerCase();
  const gender=String(url.searchParams.get("gender")||"").trim().toLowerCase();
  let where="WHERE ce.scheduled_at BETWEEN ? AND ?";
  const binds=[since,until];
  if (sport) { where+=" AND lower(ce.sport)=?"; binds.push(sport); }
  if (gender) { where+=" AND lower(ce.gender)=?"; binds.push(gender); }
  binds.push(MAX_SCORES_ROWS);
  const result=await env.DB.prepare(`
    SELECT ce.id AS canonical_event_id,ce.sport,ce.gender,ce.season,ce.scheduled_at,ce.scheduled_time_known,
      ce.venue,ce.location_text,ce.latitude,ce.longitude,ce.status,ce.home_score,ce.away_score,
      ce.home_school_id,ce.away_school_id,
      CASE
        WHEN ce.conference_game=1 THEN 1
        WHEN EXISTS (
          SELECT 1
          FROM teams ht
          JOIN teams at ON at.school_id=ce.away_school_id
            AND at.active=1
            AND at.sport=ce.sport
            AND at.gender=ce.gender
            AND at.season=ce.season
            AND at.conference_id=ht.conference_id
          WHERE ht.school_id=ce.home_school_id
            AND ht.active=1
            AND ht.sport=ce.sport
            AND ht.gender=ce.gender
            AND ht.season=ce.season
            AND ht.conference_id IS NOT NULL
        ) THEN 1
        ELSE 0
      END AS conference_game,
      ce.trust_state AS data_trust,ce.conflict_count,
      hs.name AS home_school_name,hs.mascot AS home_mascot,hs.logo_url AS home_logo_url,
      aws.name AS away_school_name,aws.mascot AS away_mascot,aws.logo_url AS away_logo_url
    FROM canonical_events ce
    JOIN schools hs ON hs.id=ce.home_school_id AND hs.catalog_scope='local'
    JOIN schools aws ON aws.id=ce.away_school_id AND aws.catalog_scope='local'
    ${where}
    ORDER BY ce.scheduled_at,ce.id
    LIMIT ?
  `).bind(...binds).all();
  console.log("canonical scores read", {
    games:(result.results||[]).length,
    sport:sport||"all",
    rowsRead:Number(result.meta?.rows_read||0),
    rowsWritten:Number(result.meta?.rows_written||0)
  });
  return json({games:result.results||[],since,until});
}

export default {
  async fetch(request, env, ctx) {
    if (request.method==="GET") {
      const url=new URL(request.url);
      if (url.pathname==="/api/v1/games") return nearbyGames(request,env,url);
      if (url.pathname==="/api/v1/scores") return scores(request,env,url);
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx) { return app.scheduled(controller,env,ctx); }
};

export { MAX_SCORES_ROWS, MAX_SCORES_WINDOW_MS, dateRange, finiteNumber, haversineMiles, resolvedNearbyGame };
