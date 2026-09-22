import app from "./m8-worker.js";
import { canonicalPublicSchoolId } from "./m4-public-worker.js";
import { ensureOneTruthFresh, ensureOneTruthSchema, oneTruthTableName, rebuildOneTruth, staleOneTruthTeamIds } from "./one-truth.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { runDragonFlyTargetedCollection } from "./dragonfly-statewide.js";
import { runDueCollections } from "./index.js";

const TABLE = oneTruthTableName();
const BOOTSTRAP_PATH = "/api/v1/internal/one-truth-bootstrap-20260919-7c4b1d9e3";
const AUDIT_PATH = "/api/v1/internal/one-truth-audit-20260919-7c4b1d9e3";
const ACCURACY_REPAIR_PATH = "/api/v1/internal/accuracy-repair-20260920-e4f7c1a9";
const ONE_SHOT_EXPIRES_AT = Date.parse("2026-09-20T21:30:00Z");
const BOOTSTRAP_BATCH = 64;
const SCHEDULED_TRUTH_BATCH = 64;
const MAX_SCHEDULED_TRUTH_BATCHES = 20;

const ACCURACY_REPAIR_HIGH_SCHOOL_TEAMS = [
  "df-354bu3-volleyball-2026","df-7k6qj6-volleyball-2026","df-bf8zxn-volleyball-2026",
  "df-bjp5e4-volleyball-2026","df-cueaqq-volleyball-2026","df-jh2s9b-volleyball-2026",
  "df-ktr7yd-volleyball-2026","df-suqu5r-volleyball-2026","greenbrier-volleyball-2026",
  "vilonia-volleyball-2026"
];
const ACCURACY_REPAIR_COLLEGE_SOURCES = [
  "college-arkansas-baptist-football-men-2026-sidearm",
  "college-arkansas-state-football-men-2026-sidearm",
  "college-arkansas-state-volleyball-women-2026-sidearm",
  "college-arkansas-tech-football-men-2026-sidearm",
  "college-arkansas-tech-volleyball-women-2026-sidearm",
  "hendrix-football-official",
  "college-hendrix-soccer-men-2026-sidearm",
  "college-hendrix-soccer-women-2026-sidearm",
  "college-hendrix-volleyball-women-2026-sidearm",
  "college-john-brown-soccer-men-2026-sidearm",
  "college-john-brown-soccer-women-2026-sidearm",
  "college-john-brown-volleyball-women-2026-sidearm",
  "college-ouachita-baptist-football-men-2026-sidearm",
  "college-ouachita-baptist-soccer-men-2026-sidearm",
  "college-ouachita-baptist-soccer-women-2026-sidearm",
  "college-southern-arkansas-football-men-2026-sidearm",
  "college-uam-football-men-2026-sidearm",
  "college-uam-volleyball-women-2026-sidearm",
  "college-uapb-football-men-2026-sidearm",
  "college-uapb-volleyball-women-2026-sidearm"
];

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

function conferenceSlug(value) {
  return String(value||"")
    .trim()
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function conferenceSlugMatches(value, candidates) {
  const slug=conferenceSlug(value);
  if(!slug) return false;
  return candidates.some(candidate =>
    slug===candidate
    || slug.startsWith(candidate+"-")
    || slug.endsWith("-"+candidate)
    || slug.includes("-"+candidate+"-")
  );
}

async function teamIdsForConference(env, sport, conferenceCandidates = []) {
  const candidates=[...new Set((conferenceCandidates||[]).map(conferenceSlug).filter(Boolean))];
  if(!sport||!candidates.length) return [];
  const {results=[]}=await env.DB.prepare(`
    SELECT team_id,school_id,sport,conference_id,conference_name
    FROM ${TABLE}
    WHERE row_type='TEAM'
      AND conference_membership_state='member'
      AND conference_id IS NOT NULL
    ORDER BY sport,conference_id,team_id
  `).all();

  const requestedSport=String(sport).toLowerCase();
  const sportRows=results.filter(row=>String(row.sport||"").toLowerCase()===requestedSport);
  const matchesRequested=row =>
    conferenceSlugMatches(row.conference_id,candidates)
    || conferenceSlugMatches(row.conference_name,candidates);

  const direct=sportRows.filter(matchesRequested);
  if(direct.length) return direct.map(row=>String(row.team_id||"")).filter(Boolean);

  // UI routes may carry a school/general conference slug (for example 7a-central)
  // while the requested sport has a different canonical classification (for
  // example 6a-central-volleyball). Bridge only through schools already proven
  // by ONE_TRUTH to belong to the requested cross-sport cohort.
  const anchorSchools=new Set(results.filter(matchesRequested).map(row=>String(row.school_id||"")).filter(Boolean));
  if(!anchorSchools.size) return [];

  const overlap=new Map();
  for(const row of sportRows) {
    if(!anchorSchools.has(String(row.school_id||""))) continue;
    const conferenceId=String(row.conference_id||"");
    if(!conferenceId) continue;
    if(!overlap.has(conferenceId)) overlap.set(conferenceId,{conferenceId,count:0});
    overlap.get(conferenceId).count++;
  }
  const ranked=[...overlap.values()].sort((a,b)=>b.count-a.count || a.conferenceId.localeCompare(b.conferenceId));
  if(!ranked.length || (ranked[1] && ranked[1].count===ranked[0].count)) return [];
  const resolvedConferenceId=ranked[0].conferenceId;
  return sportRows
    .filter(row=>String(row.conference_id||"")===resolvedConferenceId)
    .map(row=>String(row.team_id||""))
    .filter(Boolean);
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

async function accuracyRepairStage(env,url) {
  if (Date.now()>ONE_SHOT_EXPIRES_AT) return json({error:"expired"},410);
  const stage=String(url.searchParams.get("stage")||"");
  try {
    if(stage==="highschool"){
      const result=await runDragonFlyTargetedCollection(env,{teamIds:ACCURACY_REPAIR_HIGH_SCHOOL_TEAMS});
      return json({status:"SUCCESS",stage,result});
    }
    if(stage==="college1" || stage==="college2"){
      const offset=stage==="college1"?0:10;
      const sourceIds=ACCURACY_REPAIR_COLLEGE_SOURCES.slice(offset,offset+10);
      const result=await runDueCollections(env,{force:true,sourceIds,reason:"accuracy-repair-20260920"});
      const failures=(result.outcomes||[]).filter(row=>row.status==="FAILURE");
      if((result.outcomes||[]).length!==sourceIds.length || failures.length){
        return json({status:"FAILURE",stage,sourceIds,result,failures},500);
      }
      return json({status:"SUCCESS",stage,sourceIds,result});
    }
    return json({error:"invalid_stage",allowed:["highschool","college1","college2"]},400);
  } catch(error) {
    return json({error:"accuracy_repair_failed",stage,detail:String(error?.stack||error?.message||error)},500);
  }
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
        AND LOWER(COALESCE(source_id,'')) LIKE '%-official-school-results'
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
  const statewide=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});
  const sourceVsTruth=statewide?.source_vs_truth?.summary || {};
  const problems={
    missing_team_rows:Math.max(0,Number(coverage?.active_teams||0)-Number(coverage?.truth_teams||0)),
    result_only_games:Number(resultOnly?.count||0),
    record_mismatches:Number(recordMismatch?.count||0),
    conference_flag_mismatches:Number(conferenceMismatch?.count||0),
    rank_mismatches:Number(rankMismatch?.count||0),
    source_final_count_mismatches:Number(sourceVsTruth.teams_with_final_count_mismatch||0),
    result_enrichment_missing_from_truth:Number(sourceVsTruth.result_enrichment_missing_from_truth||0),
    one_truth_surface_blocking_issues:Number(statewide?.summary?.one_truth_surface_blocking_issues||0),
    statewide_presentation_blocking_issues:Number(statewide?.summary?.blocking_issues||0)
  };
  return json({
    status:Object.values(problems).some(Boolean)?"FAIL":"PASS",
    truth_table:TABLE,
    active_teams:Number(coverage?.active_teams||0),
    truth_teams:Number(coverage?.truth_teams||0),
    truth_games:Number(coverage?.truth_games||0),
    problems,
    upstream_observations:{
      detected_issues:Number(statewide?.summary?.upstream_source_observation_issues||0),
      detected_blocking_by_source_rules:Number(statewide?.summary?.source_surface_blocking_issues||0),
      issues_by_code:statewide?.summary?.upstream_source_issues_by_code||{}
    },
    statewide_audit:statewide
  },200);
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
  const requested=[...new Set(
    String(url.searchParams.get("school_ids")||"")
      .split(",")
      .map(value=>value.trim())
      .filter(Boolean)
  )].slice(0,32);
  const resolutions=requested.map(requestedSchoolId=>{
    const schoolId=canonicalPublicSchoolId(requestedSchoolId);
    return {
      requested_school_id:requestedSchoolId,
      school_id:schoolId || null,
      resolution_method:schoolId && schoolId!==requestedSchoolId ? "legacy-alias" : "one-truth-exact"
    };
  }).filter(row=>row.school_id);
  const canonicalIds=[...new Set(resolutions.map(row=>String(row.school_id)).filter(Boolean))];
  const teamIds=await activeTeamIdsForSchools(env,canonicalIds);
  await ensureOneTruthFresh(env,{teamIds});
  const rows=await teamRowsForSchools(env,canonicalIds);
  const knownSchools=new Set(rows.map(row=>String(row.school_id||"")).filter(Boolean));
  return json({
    school_ids:requested,
    resolved_school_ids:canonicalIds.filter(id=>knownSchools.has(id)),
    team_statuses:rows.map(statusFromRow),
    school_id_resolutions:resolutions.filter(row=>knownSchools.has(String(row.school_id))),
    truth_table:TABLE
  },200);
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
  const sport=String(url.searchParams.get("sport")||"").toLowerCase();
  const requested=String(url.searchParams.get("conference")||"").toLowerCase();
  if(!sport || !requested) return json({error:"invalid_standings_request"},400);

  const conferenceCandidates=[requested,requested+"-"+sport].filter(Boolean);
  const teamIds=await teamIdsForConference(env,sport,conferenceCandidates);
  await ensureOneTruthFresh(env,{teamIds});

  const {results=[]}=teamIds.length
    ? await env.DB.prepare(`
        SELECT * FROM ${TABLE}
        WHERE row_type='TEAM'
          AND team_id IN (SELECT value FROM json_each(?))
        ORDER BY rank IS NULL,rank,school_name
      `).bind(JSON.stringify(teamIds)).all()
    : {results:[]};

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

  const first=results[0]||null;
  return json({
    conference:{
      id:first?.conference_id||requested,
      name:first?.conference_name||requested,
      sport,
      standings_method:"one-truth",
      presentation_method:"one-truth",
      presentation_source_url:null
    },
    standings,
    retrieved_at:new Date().toISOString(),
    truth_table:TABLE
  },200);
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    const path=url.pathname;

    if (request.method==="POST" && path===ACCURACY_REPAIR_PATH) return accuracyRepairStage(env,url);
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
    let result;
    let upstreamError=null;
    try {
      result=await app.scheduled(controller,env,ctx);
    } catch (error) {
      upstreamError=error;
      console.error("upstream scheduled chain failed before ONE_TRUTH_TB refresh",error);
    }

    let truthError=null;
    try {
      await ensureOneTruthSchema(env);

      const scheduledTeamIds=[...new Set(
        (result?.touchedTeamIds||[]).map(String).filter(Boolean)
      )];
      const repairTeamIds=[...new Set(
        (result?.integrity?.refresh_team_ids||[]).map(String).filter(Boolean)
      )];
      const explicitTeamIds=[...new Set([...scheduledTeamIds,...repairTeamIds])];
      if(explicitTeamIds.length){
        const explicitRefresh=await rebuildOneTruth(env,{teamIds:explicitTeamIds});
        console.log("ONE_TRUTH_TB refreshed scheduled touched teams",{
          ...explicitRefresh,
          scheduled_team_ids:scheduledTeamIds,
          integrity_team_ids:repairTeamIds
        });
      }

      let batches=0;
      let refreshedTeams=repairTeamIds.length;
      while(batches<MAX_SCHEDULED_TRUTH_BATCHES){
        const stale=await staleOneTruthTeamIds(env,{limit:SCHEDULED_TRUTH_BATCH});
        if(!stale.length) break;
        const refresh=await rebuildOneTruth(env,{teamIds:stale});
        refreshedTeams+=stale.length;
        batches++;
        console.log("ONE_TRUTH_TB refreshed stale collection batch",{batch:batches,teams:stale.length,refresh});
      }

      const remaining=await staleOneTruthTeamIds(env,{limit:1});
      if(remaining.length) throw new Error("ONE_TRUTH_TB scheduled refresh fuse exhausted before clearing stale teams");
      console.log("ONE_TRUTH_TB scheduled refresh complete",{batches,refreshedTeams});
    } catch (error) {
      truthError=error;
      console.error("ONE_TRUTH_TB scheduled refresh failed",error);
    }

    if(upstreamError){
      if(truthError) console.error("ONE_TRUTH_TB refresh also failed after upstream scheduled failure",truthError);
      throw upstreamError;
    }
    if(truthError) throw truthError;
    return result;
  }
};

export { TABLE as ONE_TRUTH_TABLE, BOOTSTRAP_PATH, AUDIT_PATH, ONE_SHOT_EXPIRES_AT };
