import app from "./m8-worker.js";
import { ensureOneTruthFresh, ensureOneTruthSchema, oneTruthTableName, rebuildOneTruth, staleOneTruthTeamIds } from "./one-truth.js";

const TABLE = oneTruthTableName();
const BOOTSTRAP_PATH = "/api/v1/internal/one-truth-bootstrap-20260919-7c4b1d9e";
const AUDIT_PATH = "/api/v1/internal/one-truth-audit-20260919-7c4b1d9e";
const ONE_SHOT_EXPIRES_AT = Date.parse("2026-09-20T03:00:00Z");
const BOOTSTRAP_BATCH = 64;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-localbleachers-truth":"ONE_TRUTH_TB",
      ...extraHeaders
    }
  });
}

function recordParts(row) {
  return {
    wins:Number(row.overall_wins || 0),
    losses:Number(row.overall_losses || 0),
    ties:Number(row.overall_ties || 0),
    conference_wins:Number(row.conference_wins || 0),
    conference_losses:Number(row.conference_losses || 0),
    conference_ties:Number(row.conference_ties || 0)
  };
}

function statusFromRow(row) {
  const record = recordParts(row);
  const member = row.conference_membership_state === "member" && Boolean(row.conference_id);
  const verified = row.truth_state === "VERIFIED";
  const conferenceGames = Number(row.conference_scored_finals || 0);
  return {
    team_id:row.team_id,
    reporting_team_id:row.team_id,
    school_id:row.school_id,
    school_name:row.school_name,
    level:row.school_level,
    sport:row.sport,
    gender:row.gender,
    season:row.season,
    conference_membership_state:row.conference_membership_state || (member ? "member" : "unknown"),
    conference_id:member ? row.conference_id : null,
    conference_name:member ? row.conference_name : null,
    ...record,
    overall_record:row.overall_record,
    conference_record:member ? row.conference_record : null,
    rank:row.rank == null ? null : Number(row.rank),
    overall_games:Number(row.scored_finals || 0),
    conference_games:conferenceGames,
    record_verified:verified,
    standings_verified:member && row.rank != null,
    record_state:row.truth_state || "UNVERIFIED",
    record_audit_state:row.truth_state || "UNVERIFIED",
    record_source:"ONE_TRUTH_TB",
    source:"ONE_TRUTH_TB",
    standing_state:member
      ? (conferenceGames > 0 ? (row.rank == null ? "unavailable" : "verified") : "not-started")
      : (row.conference_membership_state || "unknown"),
    display_overall_record:row.overall_record,
    display_conference_record:member ? (row.conference_record || "0-0") : null,
    display_rank:row.rank == null ? null : Number(row.rank),
    display_method:"one-truth",
    display_source_url:null,
    calculated_at:row.refreshed_at,
    record_issues:[]
  };
}

function gameFromRow(row) {
  const record = recordParts(row);
  return {
    id:row.canonical_event_id || row.game_id || row.truth_id,
    canonical_event_id:row.canonical_event_id || null,
    reporting_team_id:row.team_id,
    team_id:row.team_id,
    school_id:row.school_id,
    school_name:row.school_name,
    level:row.school_level,
    sport:row.sport,
    gender:row.gender,
    season:row.season,
    conference_id:row.conference_id || null,
    conference_name:row.conference_name || null,
    rank:row.rank == null ? null : Number(row.rank),
    ...record,
    canonical_home_school_id:row.canonical_home_school_id || null,
    canonical_away_school_id:row.canonical_away_school_id || null,
    canonical_home_name:row.canonical_home_name || null,
    canonical_away_name:row.canonical_away_name || null,
    opponent_school_id:row.opponent_school_id || null,
    opponent:row.opponent || "Opponent TBA",
    scheduled_at:row.scheduled_at,
    canonical_scheduled_at:row.scheduled_at,
    scheduled_time_known:Number(row.scheduled_time_known ?? 1),
    canonical_time_known:Number(row.scheduled_time_known ?? 1),
    venue:row.venue || null,
    canonical_venue:row.venue || null,
    latitude:row.latitude == null ? null : Number(row.latitude),
    longitude:row.longitude == null ? null : Number(row.longitude),
    home_away:row.home_away || "unknown",
    conference_game:Number(row.conference_game || 0),
    canonical_conference_game:Number(row.conference_game || 0),
    counts_for_record:Number(row.counts_for_record ?? 1),
    status:row.status || "SCHEDULED",
    canonical_status:row.status || "SCHEDULED",
    team_score:row.team_score == null ? null : Number(row.team_score),
    opponent_score:row.opponent_score == null ? null : Number(row.opponent_score),
    result:row.result || null,
    source_id:row.source_id || null,
    source_type:row.source_type || null,
    parser_type:row.parser_type || null,
    source_url:row.source_url || null,
    data_trust:row.data_trust || "ONE_TRUTH",
    conflict_count:Number(row.conflict_count || 0),
    calculated_at:row.refreshed_at
  };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  if (![lat1,lon1,lat2,lon2].every(Number.isFinite)) return null;
  const r = 3958.7613;
  const rad = value => value * Math.PI / 180;
  const dLat = rad(lat2-lat1);
  const dLon = rad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 2*r*Math.asin(Math.sqrt(a));
}

async function teamRowsForSchools(env, schoolIds) {
  const ids=[...new Set((schoolIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];
  const {results=[]}=await env.DB.prepare(`
    SELECT * FROM ${TABLE}
    WHERE row_type='TEAM'
      AND school_id IN (SELECT value FROM json_each(?))
    ORDER BY school_name,sport,gender,team_id
  `).bind(JSON.stringify(ids)).all();
  return results;
}

async function gamesForSchool(env, schoolId) {
  const {results=[]}=await env.DB.prepare(`
    SELECT * FROM ${TABLE}
    WHERE row_type='GAME' AND school_id=?
    ORDER BY scheduled_at,sport,gender,truth_id
  `).bind(schoolId).all();
  return results;
}

async function gameRowsForTeam(env, teamId) {
  const {results=[]}=await env.DB.prepare(`
    SELECT * FROM ${TABLE}
    WHERE row_type='GAME' AND team_id=?
    ORDER BY scheduled_at,truth_id
  `).bind(teamId).all();
  return results;
}

async function summaryForTeam(env, teamId) {
  return env.DB.prepare(`
    SELECT * FROM ${TABLE}
    WHERE row_type='TEAM' AND team_id=?
  `).bind(teamId).first();
}


async function activeTeamIdsForSchools(env, schoolIds = []) {
  const ids=[...new Set((schoolIds||[]).map(String).filter(Boolean))];
  if(!ids.length) return [];
  const {results=[]}=await env.DB.prepare(`
    SELECT t.id
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND t.school_id IN (SELECT value FROM json_each(?))
    ORDER BY t.id
  `).bind(JSON.stringify(ids)).all();
  return results.map(row=>String(row.id||"")).filter(Boolean);
}

async function teamIdsForConference(env, sport, conferenceCandidates = []) {
  const candidates=[...new Set((conferenceCandidates||[]).map(value=>String(value||"").toLowerCase()).filter(Boolean))];
  if(!sport||!candidates.length) return [];
  const {results=[]}=await env.DB.prepare(`
    SELECT DISTINCT t.id
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN conference_memberships cm ON cm.team_id=t.id
    LEFT JOIN conferences vc ON vc.id=cm.conference_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND LOWER(t.sport)=?
      AND (
        LOWER(COALESCE(cm.conference_id,t.conference_id,'')) IN (SELECT value FROM json_each(?))
        OR LOWER(REPLACE(COALESCE(vc.name,c.name,''),' ','-')) IN (SELECT value FROM json_each(?))
      )
    ORDER BY t.id
  `).bind(String(sport).toLowerCase(),JSON.stringify(candidates),JSON.stringify(candidates)).all();
  return results.map(row=>String(row.id||"")).filter(Boolean);
}

async function nearbyTeamIds(env, url) {
  const lat=Number(url.searchParams.get("lat"));
  const lon=Number(url.searchParams.get("lon"));
  const radius=Math.max(1,Number(url.searchParams.get("radius")||25));
  const since=url.searchParams.get("since")||new Date(Date.now()-6*60*60*1000).toISOString();
  const until=url.searchParams.get("until")||new Date(Date.now()+30*24*60*60*1000).toISOString();
  const hasGeo=[lat,lon,radius].every(Number.isFinite);
  const binds=[since,until];
  let geoSql="";

  if(hasGeo){
    const latDelta=radius/69;
    const lonScale=Math.max(0.2,Math.cos(lat*Math.PI/180));
    const lonDelta=radius/(69*lonScale);
    geoSql=" AND g.latitude BETWEEN ? AND ? AND g.longitude BETWEEN ? AND ?";
    binds.push(lat-latDelta,lat+latDelta,lon-lonDelta,lon+lonDelta);
  }

  const {results=[]}=await env.DB.prepare(`
    SELECT DISTINCT g.team_id
    FROM games g
    JOIN teams t ON t.id=g.team_id
    JOIN schools sch ON sch.id=t.school_id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND g.scheduled_at BETWEEN ? AND ?
      ${geoSql}
    ORDER BY g.team_id
    LIMIT 256
  `).bind(...binds).all();
  return results.map(row=>String(row.team_id||"")).filter(Boolean);
}

async function oneTruthBootstrapBatch(env, url) {
  if (Date.now()>ONE_SHOT_EXPIRES_AT) return json({error:"expired"},410);
  try {
    await ensureOneTruthSchema(env);
  const after=String(url.searchParams.get("after")||"");
  const {results=[]}=await env.DB.prepare(`
    SELECT t.id
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND t.id>?
    ORDER BY t.id
    LIMIT ?
  `).bind(after,BOOTSTRAP_BATCH).all();
  const teamIds=results.map(row=>String(row.id||"")).filter(Boolean);
  if(!teamIds.length) return json({status:"SUCCESS",done:true,after,teams:0,truth_table:TABLE});
  const refresh=await rebuildOneTruth(env,{teamIds});
  const next=teamIds[teamIds.length-1];
    return json({
      status:"SUCCESS",
      done:teamIds.length<BOOTSTRAP_BATCH,
      next_after:next,
      teams:teamIds.length,
      refresh,
      truth_table:TABLE
    });
  } catch (error) {
    console.error("ONE_TRUTH_TB bootstrap failed",error);
    return json({
      error:"one_truth_bootstrap_failed",
      detail:String(error?.stack || error?.message || error)
    },500);
  }
}

async function oneTruthAudit(env) {
  if (Date.now()>ONE_SHOT_EXPIRES_AT) return json({error:"expired"},410);
  await ensureOneTruthSchema(env);
  const [coverage,resultOnly,recordMismatch,conferenceMismatch,rankMismatch]=await Promise.all([
    env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM teams t JOIN schools s ON s.id=t.school_id
          WHERE t.active=1 AND t.season='2026' AND s.catalog_scope='local') AS active_teams,
        (SELECT COUNT(*) FROM ${TABLE} WHERE row_type='TEAM') AS truth_teams,
        (SELECT COUNT(*) FROM ${TABLE} WHERE row_type='GAME') AS truth_games
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM ${TABLE}
      WHERE row_type='GAME'
        AND LOWER(COALESCE(parser_type,'')) IN ('mascot-media','rankone-public')
        AND LOWER(COALESCE(source_type,''))='official-school'
    `).first(),
    env.DB.prepare(`
      WITH agg AS (
        SELECT team_id,
          SUM(CASE WHEN status='FINAL' AND counts_for_record<>0 AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND team_score>opponent_score THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN status='FINAL' AND counts_for_record<>0 AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND team_score<opponent_score THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN status='FINAL' AND counts_for_record<>0 AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND team_score=opponent_score THEN 1 ELSE 0 END) AS ties,
          SUM(CASE WHEN status='FINAL' AND counts_for_record<>0 AND conference_game=1 AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND team_score>opponent_score THEN 1 ELSE 0 END) AS cw,
          SUM(CASE WHEN status='FINAL' AND counts_for_record<>0 AND conference_game=1 AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND team_score<opponent_score THEN 1 ELSE 0 END) AS cl,
          SUM(CASE WHEN status='FINAL' AND counts_for_record<>0 AND conference_game=1 AND team_score IS NOT NULL AND opponent_score IS NOT NULL AND team_score=opponent_score THEN 1 ELSE 0 END) AS ct
        FROM ${TABLE}
        WHERE row_type='GAME'
        GROUP BY team_id
      )
      SELECT COUNT(*) AS count
      FROM ${TABLE} t
      LEFT JOIN agg a ON a.team_id=t.team_id
      WHERE t.row_type='TEAM'
        AND (
          COALESCE(t.overall_wins,0)<>COALESCE(a.wins,0)
          OR COALESCE(t.overall_losses,0)<>COALESCE(a.losses,0)
          OR COALESCE(t.overall_ties,0)<>COALESCE(a.ties,0)
          OR COALESCE(t.conference_wins,0)<>COALESCE(a.cw,0)
          OR COALESCE(t.conference_losses,0)<>COALESCE(a.cl,0)
          OR COALESCE(t.conference_ties,0)<>COALESCE(a.ct,0)
        )
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM ${TABLE} g
      JOIN teams ot
        ON ot.school_id=g.opponent_school_id
       AND ot.sport=g.sport
       AND ot.gender=g.gender
       AND ot.season=g.season
       AND ot.active=1
      LEFT JOIN conference_memberships ocm ON ocm.team_id=ot.id
      WHERE g.row_type='GAME'
        AND g.conference_membership_state='member'
        AND g.conference_id IS NOT NULL
        AND COALESCE(ocm.conference_id,ot.conference_id)=g.conference_id
        AND COALESCE(g.conference_game,0)<>1
    `).first(),
    env.DB.prepare(`
      WITH base AS (
        SELECT team_id,conference_id,sport,gender,season,rank,
          COALESCE(conference_wins,0) AS cw,
          COALESCE(conference_losses,0) AS cl,
          COALESCE(conference_ties,0) AS ct,
          SUM(COALESCE(conference_scored_finals,0)) OVER (
            PARTITION BY conference_id,sport,gender,season
          ) AS cohort_games
        FROM ${TABLE}
        WHERE row_type='TEAM'
          AND conference_membership_state='member'
          AND conference_id IS NOT NULL
      ),
      ranked AS (
        SELECT team_id,rank,
          CASE WHEN cohort_games=0 THEN NULL ELSE
            RANK() OVER (
              PARTITION BY conference_id,sport,gender,season
              ORDER BY
                CASE WHEN (cw+cl+ct)>0 THEN (CAST(cw AS REAL)+0.5*ct)/(cw+cl+ct) ELSE 0 END DESC,
                cw DESC,cl ASC,ct ASC
            )
          END AS expected_rank
        FROM base
      )
      SELECT COUNT(*) AS count
      FROM ranked
      WHERE rank IS NOT expected_rank
    `).first()
  ]);
  const problems={
    missing_team_rows:Math.max(0,Number(coverage?.active_teams||0)-Number(coverage?.truth_teams||0)),
    result_only_games:Number(resultOnly?.count||0),
    record_mismatches:Number(recordMismatch?.count||0),
    conference_flag_mismatches:Number(conferenceMismatch?.count||0),
    rank_mismatches:Number(rankMismatch?.count||0)
  };
  return json({
    status:Object.values(problems).some(Boolean)?"FAIL":"PASS",
    truth_table:TABLE,
    active_teams:Number(coverage?.active_teams||0),
    truth_teams:Number(coverage?.truth_teams||0),
    truth_games:Number(coverage?.truth_games||0),
    problems
  },Object.values(problems).some(Boolean)?409:200);
}

async function nearbyGames(env, url) {
  const lat=Number(url.searchParams.get("lat"));
  const lon=Number(url.searchParams.get("lon"));
  const radius=Math.max(1,Number(url.searchParams.get("radius")||25));
  const since=url.searchParams.get("since")||new Date(Date.now()-6*60*60*1000).toISOString();
  const until=url.searchParams.get("until")||new Date(Date.now()+30*24*60*60*1000).toISOString();
  const hasGeo=[lat,lon,radius].every(Number.isFinite);
  const binds=[since,until];
  let geoSql="";

  if (hasGeo) {
    const latDelta=radius/69;
    const lonScale=Math.max(0.2,Math.cos(lat*Math.PI/180));
    const lonDelta=radius/(69*lonScale);
    geoSql=" AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?";
    binds.push(lat-latDelta,lat+latDelta,lon-lonDelta,lon+lonDelta);
  }

  const {results=[]}=await env.DB.prepare(`
    SELECT * FROM ${TABLE}
    WHERE row_type='GAME'
      AND scheduled_at BETWEEN ? AND ?
      ${geoSql}
    ORDER BY scheduled_at,school_name,sport,gender,truth_id
  `).bind(...binds).all();

  return results
    .map(row => {
      const game=gameFromRow(row);
      if (hasGeo) {
        const distance=haversineMiles(lat,lon,Number(game.latitude),Number(game.longitude));
        if (distance==null || distance>radius) return null;
        game.distance_miles=distance;
      }
      return game;
    })
    .filter(Boolean);
}

async function teamStatusesResponse(request, env, ctx, url) {
  const requested=String(url.searchParams.get("school_ids")||"")
    .split(",").map(value=>value.trim()).filter(Boolean);
  const upstream=await app.fetch(request,env,ctx);
  let upstreamBody={};
  try { upstreamBody=await upstream.clone().json(); } catch {}
  const resolutions=Array.isArray(upstreamBody?.school_id_resolutions) ? upstreamBody.school_id_resolutions : [];
  const canonicalIds=[...new Set([
    ...requested,
    ...resolutions.map(row=>String(row?.school_id||"")).filter(Boolean)
  ])];
  const teamIds=await activeTeamIdsForSchools(env,canonicalIds);
  await ensureOneTruthFresh(env,{teamIds});
  const rows=await teamRowsForSchools(env,canonicalIds);
  return json({
    ...upstreamBody,
    team_statuses:rows.map(statusFromRow),
    school_id_resolutions:resolutions.length ? resolutions : requested.map(id=>({
      requested_school_id:id,
      school_id:rows.some(row=>row.school_id===id)?id:null,
      resolution_method:rows.some(row=>row.school_id===id)?"one-truth-exact":"unresolved"
    })).filter(row=>row.school_id),
    truth_table:TABLE
  },upstream.ok?upstream.status:200);
}

async function schoolScheduleResponse(request, env, ctx, schoolId) {
  const upstream=await app.fetch(request,env,ctx);
  if (!upstream.ok) return upstream;
  let body={};
  try { body=await upstream.clone().json(); } catch {}
  const canonicalSchoolId=String(body?.canonicalSchoolId || schoolId);
  const teamIds=await activeTeamIdsForSchools(env,[canonicalSchoolId]);
  await ensureOneTruthFresh(env,{teamIds});
  const [games,statusRows]=await Promise.all([
    gamesForSchool(env,canonicalSchoolId),
    teamRowsForSchools(env,[canonicalSchoolId])
  ]);
  return json({
    ...body,
    canonicalSchoolId,
    games:games.map(gameFromRow),
    team_statuses:statusRows.map(statusFromRow),
    truth_table:TABLE
  },upstream.status);
}

async function teamScheduleResponse(env, teamId) {
  const [games,summary]=await Promise.all([
    gameRowsForTeam(env,teamId),
    summaryForTeam(env,teamId)
  ]);
  if (!summary) return json({error:"team_not_found"},404);
  return json({
    teamId,
    games:games.map(gameFromRow),
    record:statusFromRow(summary),
    record_truth:{
      state:summary.truth_state,
      verified:summary.truth_state==="VERIFIED",
      evidence_games:Number(summary.scored_finals||0),
      evidence_conference_games:Number(summary.conference_scored_finals||0),
      issues:[]
    },
    truth_table:TABLE
  });
}

async function teamRecordResponse(env, teamId) {
  const summary=await summaryForTeam(env,teamId);
  if (!summary) return json({error:"team_not_found"},404);
  const status=statusFromRow(summary);
  return json({
    record:status,
    record_truth:{
      state:summary.truth_state,
      verified:summary.truth_state==="VERIFIED",
      evidence_games:Number(summary.scored_finals||0),
      evidence_conference_games:Number(summary.conference_scored_finals||0),
      issues:[]
    },
    truth_table:TABLE
  });
}

async function standingsResponse(request, env, ctx, url) {
  const upstream=await app.fetch(request,env,ctx);
  if (!upstream.ok) return upstream;
  let body={};
  try { body=await upstream.clone().json(); } catch {}
  const sport=String(url.searchParams.get("sport")||body?.conference?.sport||"").toLowerCase();
  const requested=String(url.searchParams.get("conference")||"").toLowerCase();
  const upstreamId=String(body?.conference?.id||"").toLowerCase();
  const upstreamName=String(body?.conference?.name||"").toLowerCase();
  const conferenceCandidates=[requested,upstreamId,requested+"-"+sport,
    String(body?.conference?.name||"").toLowerCase().replace(/\s+/g,"-")].filter(Boolean);
  const teamIds=await teamIdsForConference(env,sport,conferenceCandidates);
  await ensureOneTruthFresh(env,{teamIds});

  const {results=[]}=await env.DB.prepare(`
    SELECT * FROM ${TABLE}
    WHERE row_type='TEAM'
      AND LOWER(sport)=?
      AND conference_membership_state='member'
      AND (
        LOWER(COALESCE(conference_id,'')) IN (?,?,?)
        OR LOWER(REPLACE(COALESCE(conference_name,''),' ','-'))=?
      )
    ORDER BY rank IS NULL,rank,school_name
  `).bind(sport,requested,upstreamId,requested+"-"+sport,requested).all();

  const standings=results.map(row=>{
    const status=statusFromRow(row);
    const games=Number(row.conference_scored_finals||0);
    const pct=games
      ? ((Number(row.conference_wins||0)+0.5*Number(row.conference_ties||0))/games).toFixed(3).replace(/^0/,"")
      : ".000";
    return {
      rank:status.rank,
      team_id:row.team_id,
      school_id:row.school_id,
      school_name:row.school_name,
      conference_record:status.conference_record,
      overall_record:status.overall_record,
      conference_pct:pct,
      method:"one-truth",
      calculated_at:row.refreshed_at,
      standing_state:status.standing_state,
      display_rank:status.display_rank,
      display_conference_record:status.display_conference_record,
      display_overall_record:status.display_overall_record,
      display_method:"one-truth",
      display_source_url:null
    };
  });

  return json({
    ...body,
    conference:{
      ...(body?.conference||{}),
      id:body?.conference?.id||requested,
      name:body?.conference?.name||upstreamName||requested,
      sport,
      standings_method:"one-truth",
      presentation_method:"one-truth",
      presentation_source_url:null
    },
    standings,
    retrieved_at:new Date().toISOString(),
    truth_table:TABLE
  },upstream.status);
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    const path=url.pathname;

    if (request.method==="POST" && path===BOOTSTRAP_PATH) return oneTruthBootstrapBatch(env,url);
    if (request.method==="GET" && path===AUDIT_PATH) return oneTruthAudit(env);
    if (request.method!=="GET") return app.fetch(request,env,ctx);

    const usesTruth =
      path==="/api/v1/games"
      || path==="/api/v1/team-statuses"
      || /^\/api\/v1\/schools\/[^/]+\/schedule$/.test(path)
      || /^\/api\/v1\/teams\/[^/]+\/(?:schedule|record)$/.test(path)
      || path==="/api/v1/standings";

    if (!usesTruth) return app.fetch(request,env,ctx);

    try {
      await ensureOneTruthSchema(env);

      if (path==="/api/v1/games") {
        const teamIds=await nearbyTeamIds(env,url);
        await ensureOneTruthFresh(env,{teamIds});
        return json({games:await nearbyGames(env,url),truth_table:TABLE});
      }
      if (path==="/api/v1/team-statuses") return teamStatusesResponse(request,env,ctx,url);

      const schoolMatch=path.match(/^\/api\/v1\/schools\/([^/]+)\/schedule$/);
      if (schoolMatch) return schoolScheduleResponse(request,env,ctx,decodeURIComponent(schoolMatch[1]));

      const teamMatch=path.match(/^\/api\/v1\/teams\/([^/]+)\/(schedule|record)$/);
      if (teamMatch) {
        const teamId=decodeURIComponent(teamMatch[1]);
        await ensureOneTruthFresh(env,{teamIds:[teamId]});
        return teamMatch[2]==="schedule" ? teamScheduleResponse(env,teamId) : teamRecordResponse(env,teamId);
      }

      if (path==="/api/v1/standings") return standingsResponse(request,env,ctx,url);
    } catch (error) {
      console.error("ONE_TRUTH_TB read failed",error);
      return json({
        error:"one_truth_unavailable",
        message:"Canonical presentation truth is temporarily unavailable.",
        detail:String(error?.message||error)
      },503);
    }

    return app.fetch(request,env,ctx);
  },

  async scheduled(controller, env, ctx) {
    const result=await app.scheduled(controller,env,ctx);
    try {
      await ensureOneTruthSchema(env);
      const stale=await staleOneTruthTeamIds(env,{limit:64});
      if(stale.length){
        const refresh=await rebuildOneTruth(env,{teamIds:stale});
        console.log("ONE_TRUTH_TB refreshed after collection",refresh);
      }
    } catch (error) {
      console.error("ONE_TRUTH_TB scheduled refresh failed",error);
      throw error;
    }
    return result;
  }
};

export { TABLE as ONE_TRUTH_TABLE, BOOTSTRAP_PATH, AUDIT_PATH, ONE_SHOT_EXPIRES_AT };
