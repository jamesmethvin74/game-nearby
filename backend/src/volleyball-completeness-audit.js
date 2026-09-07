import { dedupeScheduleRows, recordFromScheduleRows } from "./schedule-response-normalizer.js";
import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { fetchPublishedStandings, listPublishedStandingsOptions } from "./published-standings.js";
import { matchLocalVolleyballTeams, maxPrepsScoresUrl, parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";

const SPORT = "volleyball";
const GENDER = "girls";
const SEASON = "2026";
const TIME_ZONE = "America/Chicago";
const SEASON_START = "2026-08-01";
const SEASON_END_EXCLUSIVE = "2026-12-01";
const AUTHORITY_BATCH_SIZE = 5;
const MAX_AUTHORITY_DAYS = 110;
const MAX_EXCEPTIONS_PER_TYPE = 50;

// This audit is intentionally read-only. The three statements are set-based and
// restricted to active, local Arkansas varsity girls volleyball teams for 2026.
const TEAM_SNAPSHOT_SQL = `
  WITH vb_teams AS (
    SELECT t.id AS team_id,t.school_id,t.conference_id,t.sport,t.gender,t.season,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
      s.name AS raw_school_name,s.location_matched_name,s.city,s.state,
      c.name AS conference_name
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.active=1
      AND t.sport='volleyball'
      AND t.gender='girls'
      AND t.season='2026'
      AND s.level='high-school'
      AND s.state='AR'
      AND s.catalog_scope='local'
  )
  SELECT vt.*,
    CASE WHEN r.team_id IS NULL THEN 0 ELSE 1 END AS record_exists,
    COALESCE(r.wins,0) AS wins,COALESCE(r.losses,0) AS losses,COALESCE(r.ties,0) AS ties,
    COALESCE(r.conference_wins,0) AS conference_wins,
    COALESCE(r.conference_losses,0) AS conference_losses,
    COALESCE(r.conference_ties,0) AS conference_ties,
    r.calculated_at AS record_calculated_at,
    st.rank AS standings_rank,st.conference_record AS standings_conference_record,
    st.overall_record AS standings_overall_record,st.method AS standings_method,
    st.calculated_at AS standings_calculated_at,
    (SELECT COUNT(*) FROM sources src WHERE src.team_id=vt.team_id) AS source_count,
    (SELECT COUNT(*) FROM sources src WHERE src.team_id=vt.team_id AND src.enabled=1) AS enabled_source_count
  FROM vb_teams vt
  LEFT JOIN team_records r ON r.team_id=vt.team_id
  LEFT JOIN standings st ON st.conference_id=vt.conference_id AND st.team_id=vt.team_id
  ORDER BY vt.school_name,vt.team_id
`;

const CANONICAL_SNAPSHOT_SQL = `
  WITH vb_teams AS (
    SELECT t.id AS team_id,t.school_id
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    WHERE t.active=1
      AND t.sport='volleyball'
      AND t.gender='girls'
      AND t.season='2026'
      AND s.level='high-school'
      AND s.state='AR'
      AND s.catalog_scope='local'
  ),
  scoped_events AS (
    SELECT ce.*
    FROM canonical_events ce
    WHERE ce.scheduled_at>=? AND ce.scheduled_at<?
      AND ce.sport='volleyball'
      AND ce.gender='girls'
      AND ce.season='2026'
      AND (
        ce.participant_a_school_id IN (SELECT school_id FROM vb_teams)
        OR ce.participant_b_school_id IN (SELECT school_id FROM vb_teams)
      )
  ),
  member_agg AS (
    SELECT cem.canonical_event_id,
      COUNT(*) AS member_observation_count,
      COUNT(DISTINCT cem.reporting_team_id) AS reporting_team_count,
      GROUP_CONCAT(DISTINCT cem.reporting_team_id) AS reporting_team_ids,
      SUM(CASE WHEN mg.counts_for_record=1 THEN 1 ELSE 0 END) AS eligible_member_count
    FROM canonical_event_members cem
    JOIN scoped_events se ON se.id=cem.canonical_event_id
    JOIN games mg ON mg.id=cem.game_id
    GROUP BY cem.canonical_event_id
  ),
  conflict_agg AS (
    SELECT ec.canonical_event_id,
      SUM(CASE WHEN ec.resolved_at IS NULL THEN 1 ELSE 0 END) AS unresolved_conflict_count
    FROM event_conflicts ec
    JOIN scoped_events se ON se.id=ec.canonical_event_id
    GROUP BY ec.canonical_event_id
  )
  SELECT se.id AS canonical_event_id,se.participant_a_school_id,se.participant_b_school_id,
    se.home_school_id,se.away_school_id,se.scheduled_at,se.scheduled_time_known,
    se.status,se.home_score,se.away_score,se.conference_game,se.latitude,se.longitude,
    se.selected_source_id,se.trust_state,se.conflict_count,se.last_reconciled_at,
    COALESCE(ma.member_observation_count,0) AS member_observation_count,
    COALESCE(ma.reporting_team_count,0) AS reporting_team_count,
    ma.reporting_team_ids,
    COALESCE(ma.eligible_member_count,0) AS eligible_member_count,
    COALESCE(ca.unresolved_conflict_count,0) AS unresolved_conflict_count
  FROM scoped_events se
  LEFT JOIN member_agg ma ON ma.canonical_event_id=se.id
  LEFT JOIN conflict_agg ca ON ca.canonical_event_id=se.id
  ORDER BY se.scheduled_at,se.id
`;

const SCHEDULE_CANDIDATE_SQL = `
  WITH vb_teams AS (
    SELECT t.id AS team_id,t.school_id,t.conference_id,t.sport,t.gender,t.season
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    WHERE t.active=1
      AND t.sport='volleyball'
      AND t.gender='girls'
      AND t.season='2026'
      AND s.level='high-school'
      AND s.state='AR'
      AND s.catalog_scope='local'
  ),
  canonical_rows AS (
    SELECT cem.reporting_team_id AS team_id,vt.school_id,vt.sport,vt.gender,vt.season,
      ce.id AS canonical_event_id,
      CASE WHEN ce.home_school_id=vt.school_id THEN ce.away_school_id ELSE ce.home_school_id END AS opponent_school_id,
      COALESCE(os.name,'Opponent') AS opponent,
      ce.scheduled_at,ce.status,
      CASE WHEN ce.home_school_id=vt.school_id THEN ce.home_score ELSE ce.away_score END AS team_score,
      CASE WHEN ce.home_school_id=vt.school_id THEN ce.away_score ELSE ce.home_score END AS opponent_score,
      MAX(CASE WHEN mg.counts_for_record=1 THEN 1 ELSE 0 END) AS counts_for_record,
      CASE
        WHEN ce.conference_game=1 THEN 1
        WHEN vt.conference_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM teams ot
          WHERE ot.active=1
            AND ot.school_id=CASE WHEN ce.home_school_id=vt.school_id THEN ce.away_school_id ELSE ce.home_school_id END
            AND ot.sport=vt.sport AND ot.gender=vt.gender AND ot.season=vt.season
            AND ot.conference_id=vt.conference_id
        ) THEN 1
        ELSE 0
      END AS conference_game,
      'official-conference' AS source_type,'dragonfly-public' AS parser_type,
      ce.trust_state AS data_trust
    FROM canonical_event_members cem
    JOIN vb_teams vt ON vt.team_id=cem.reporting_team_id
    JOIN games mg ON mg.id=cem.game_id AND mg.team_id=cem.reporting_team_id
    JOIN canonical_events ce ON ce.id=cem.canonical_event_id
    LEFT JOIN schools os ON os.id=CASE WHEN ce.home_school_id=vt.school_id THEN ce.away_school_id ELSE ce.home_school_id END
    WHERE ce.scheduled_at>=? AND ce.scheduled_at<?
      AND ce.sport='volleyball' AND ce.gender='girls' AND ce.season='2026'
    GROUP BY cem.reporting_team_id,ce.id
  ),
  raw_rows AS (
    SELECT g.team_id,vt.school_id,vt.sport,vt.gender,vt.season,
      NULL AS canonical_event_id,g.opponent_school_id,COALESCE(os.name,g.opponent,'Opponent') AS opponent,
      g.scheduled_at,g.status,g.team_score,g.opponent_score,g.counts_for_record,
      CASE
        WHEN g.conference_game=1 THEN 1
        WHEN vt.conference_id IS NOT NULL AND g.opponent_school_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM teams ot
          WHERE ot.active=1 AND ot.school_id=g.opponent_school_id
            AND ot.sport=vt.sport AND ot.gender=vt.gender AND ot.season=vt.season
            AND ot.conference_id=vt.conference_id
        ) THEN 1
        ELSE 0
      END AS conference_game,
      src.source_type,src.parser_type,'SINGLE_SOURCE_LIVE' AS data_trust
    FROM games g
    JOIN vb_teams vt ON vt.team_id=g.team_id
    JOIN sources src ON src.id=g.source_id
    LEFT JOIN schools os ON os.id=g.opponent_school_id
    WHERE g.canonical_event_id IS NULL
      AND g.scheduled_at>=? AND g.scheduled_at<?
  )
  SELECT * FROM canonical_rows
  UNION ALL
  SELECT * FROM raw_rows
  ORDER BY team_id,scheduled_at,COALESCE(canonical_event_id,'')
`;

function rowsRead(result) {
  return Number(result?.meta?.rows_read || 0);
}

function rowsWritten(result) {
  return Number(result?.meta?.rows_written || 0);
}

function recordText(wins=0,losses=0,ties=0) {
  return Number(ties) ? `${Number(wins)}-${Number(losses)}-${Number(ties)}` : `${Number(wins)}-${Number(losses)}`;
}

function localDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const get = type => parts.find(part => part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localDateOffset(value, days) {
  const [year,month,day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year,month-1,day+days,18,0,0));
  return localDate(date);
}

function dateRange(start,end) {
  const rows=[];
  for(let value=start,guard=0; value && value<=end && guard<MAX_AUTHORITY_DAYS; value=localDateOffset(value,1),guard++) rows.push(value);
  return rows;
}

function pairKey(a,b) {
  return [String(a||""),String(b||"")].sort().join("|");
}

function pairDateKey(a,b,date) {
  return `${pairKey(a,b)}|${date||""}`;
}

function scoreMap(row) {
  return new Map([
    [row.home_school_id,Number(row.home_score)],
    [row.away_school_id,Number(row.away_score)]
  ]);
}

function canonicalMatchesAuthority(event,final) {
  if(event.status!=="FINAL" || event.home_score==null || event.away_score==null) return false;
  const expected = new Map([
    [final.homeTeam.school_id,Number(final.home.score)],
    [final.awayTeam.school_id,Number(final.away.score)]
  ]);
  const actual = scoreMap(event);
  return Number(actual.get(final.homeTeam.school_id))===Number(expected.get(final.homeTeam.school_id))
    && Number(actual.get(final.awayTeam.school_id))===Number(expected.get(final.awayTeam.school_id));
}

function aliasesForTeam(team) {
  return [...new Set([team.school_name,team.raw_school_name,team.location_matched_name]
    .map(normalizeSchoolAlias).filter(Boolean))];
}

function teamAliasIndex(teams) {
  const map=new Map();
  for(const team of teams) {
    for(const alias of aliasesForTeam(team)) {
      if(!map.has(alias)) map.set(alias,[]);
      map.get(alias).push(team);
    }
  }
  return map;
}

function exceptionRow({team=null,conference=null,type,localState,authorityState,recommendedRepair,details=null}) {
  return {
    school:team?.school_name || details?.school_name || null,
    team_id:team?.team_id || null,
    conference:conference?.name || team?.conference_name || details?.conference_name || null,
    conference_id:conference?.id || team?.conference_id || details?.conference_id || null,
    deficiency_type:type,
    local_state:localState,
    authority_state:authorityState,
    recommended_repair:recommendedRepair,
    ...(details?{details}: {})
  };
}

function groupExceptions(exceptions) {
  const grouped={};
  for(const row of exceptions) {
    const type=row.deficiency_type;
    if(!grouped[type]) grouped[type]={count:0,exceptions:[]};
    grouped[type].count++;
    if(grouped[type].exceptions.length<MAX_EXCEPTIONS_PER_TYPE) grouped[type].exceptions.push(row);
  }
  return grouped;
}

function expectedLocalTeamBySchool(teams) {
  const map=new Map();
  for(const team of teams) map.set(team.school_id,team);
  return map;
}

function normalizeCandidate(row) {
  return {
    ...row,
    counts_for_record:Number(row.counts_for_record||0),
    conference_game:Number(row.conference_game||0),
    team_score:row.team_score==null?null:Number(row.team_score),
    opponent_score:row.opponent_score==null?null:Number(row.opponent_score)
  };
}

function oneSideAuthorityMatches(final,aliasIndex) {
  const home=aliasIndex.get(normalizeSchoolAlias(final.home.name))||[];
  const away=aliasIndex.get(normalizeSchoolAlias(final.away.name))||[];
  if(home.length===1 && away.length===0) return {team:home[0],opponent:final.away.name};
  if(away.length===1 && home.length===0) return {team:away[0],opponent:final.home.name};
  return null;
}

export function buildVolleyballCompletenessAudit({teams=[],canonicals=[],candidates=[],published=null,maxPreps=null,generatedAt=new Date().toISOString()}={}) {
  const exceptions=[];
  const teamById=new Map(teams.map(team=>[team.team_id,team]));
  const teamBySchool=expectedLocalTeamBySchool(teams);
  const aliasIndex=teamAliasIndex(teams);
  const candidatesByTeam=new Map();
  for(const raw of candidates) {
    const row=normalizeCandidate(raw);
    if(!candidatesByTeam.has(row.team_id)) candidatesByTeam.set(row.team_id,[]);
    candidatesByTeam.get(row.team_id).push(row);
  }

  const teamAudit=[];
  for(const team of teams) {
    const rows=candidatesByTeam.get(team.team_id)||[];
    const schedule=dedupeScheduleRows(rows,{reportingSchoolId:team.school_id,maxMinutes:15});
    const rebuilt=recordFromScheduleRows(rows,{reportingSchoolId:team.school_id,maxMinutes:15});
    const storedOverall=recordText(team.wins,team.losses,team.ties);
    const storedConference=recordText(team.conference_wins,team.conference_losses,team.conference_ties);
    const rebuiltOverall=recordText(rebuilt.wins,rebuilt.losses,rebuilt.ties);
    const rebuiltConference=recordText(rebuilt.conference_wins,rebuilt.conference_losses,rebuilt.conference_ties);
    const completed=schedule.filter(row=>row.status==="FINAL" && row.team_score!=null && row.opponent_score!=null);
    const audit={
      team_id:team.team_id,school_id:team.school_id,school_name:team.school_name,
      conference_id:team.conference_id||null,conference_name:team.conference_name||null,
      schedule_games:schedule.length,completed_games:completed.length,
      record_exists:Number(team.record_exists||0)>0,
      overall_record:storedOverall,conference_record:storedConference,
      rebuilt_overall_record:rebuiltOverall,rebuilt_conference_record:rebuiltConference,
      source_count:Number(team.source_count||0),enabled_source_count:Number(team.enabled_source_count||0),
      standings_present:Boolean(team.standings_method),published_standings_present:false,
      published_overall_record:null,published_conference_record:null,
      overall_authority_agrees:null,conference_authority_agrees:null
    };
    teamAudit.push(audit);
    if(!schedule.length) exceptions.push(exceptionRow({team,type:"missing_schedule",localState:"0 local schedule games",authorityState:"not yet compared",recommendedRepair:"schedule-authority discovery/collector repair"}));
    if(!audit.record_exists) exceptions.push(exceptionRow({team,type:"missing_team_record",localState:"team_records row missing",authorityState:"canonical schedule will be compared",recommendedRepair:"scoped team record rebuild after underlying results are correct"}));
    if(audit.record_exists && (storedOverall!==rebuiltOverall || storedConference!==rebuiltConference)) {
      exceptions.push(exceptionRow({team,type:"record_rebuild_mismatch",localState:`stored ${storedOverall} (${storedConference} conf)`,authorityState:`canonical recompute ${rebuiltOverall} (${rebuiltConference} conf)`,recommendedRepair:"trace record-eligible canonical/raw finals; fix reconciliation before scoped rebuild"}));
    }
  }

  const canonicalById=new Map(canonicals.map(row=>[row.canonical_event_id,row]));
  const canonicalByPairDate=new Map();
  for(const event of canonicals) {
    const key=pairDateKey(event.participant_a_school_id,event.participant_b_school_id,localDate(event.scheduled_at));
    if(!canonicalByPairDate.has(key)) canonicalByPairDate.set(key,[]);
    canonicalByPairDate.get(key).push(event);
  }

  for(const [key,events] of canonicalByPairDate) {
    if(events.length>1) {
      for(const schoolId of new Set(events.flatMap(event=>[event.participant_a_school_id,event.participant_b_school_id]))) {
        const team=teamBySchool.get(schoolId);
        if(team) exceptions.push(exceptionRow({team,type:"duplicate_canonical_event",localState:`${events.length} canonical events for ${key}`,authorityState:"single event expected for same participants/date",recommendedRepair:"canonical reconciliation/deduplication",details:{canonical_event_ids:events.map(event=>event.canonical_event_id)}}));
      }
    }
  }

  for(const event of canonicals) {
    const localParticipants=[event.home_school_id,event.away_school_id].map(id=>teamBySchool.get(id)).filter(Boolean);
    const reportingIds=new Set(String(event.reporting_team_ids||"").split(",").filter(Boolean));
    const isFinal=event.status==="FINAL" && event.home_score!=null && event.away_score!=null;
    if(Number(event.conflict_count||0)>0 || Number(event.unresolved_conflict_count||0)>0) {
      for(const team of localParticipants) exceptions.push(exceptionRow({team,type:"contradictory_final_score",localState:`canonical ${event.status} ${event.home_score}-${event.away_score}; conflicts=${event.conflict_count}`,authorityState:`unresolved conflicts=${event.unresolved_conflict_count}`,recommendedRepair:"review authority-ranked observations and repair canonical conflict resolution",details:{canonical_event_id:event.canonical_event_id}}));
    }
    if(isFinal && (event.latitude==null || event.longitude==null)) {
      for(const team of localParticipants) exceptions.push(exceptionRow({team,type:"canonical_final_missing_coordinates",localState:"canonical final has no coordinates",authorityState:"nearby Home requires geocodable canonical location",recommendedRepair:"location enrichment/canonical location propagation",details:{canonical_event_id:event.canonical_event_id}}));
    }
    if(isFinal && localParticipants.length>=2) {
      for(const team of localParticipants) {
        if(!reportingIds.has(team.team_id)) exceptions.push(exceptionRow({team,type:"cross_surface_missing_team_attachment",localState:`canonical final ${event.canonical_event_id} is not attached to this team's schedule`,authorityState:"Scores sees canonical; Team Schedule should attach same canonical",recommendedRepair:"repair canonical_event_members/reconciliation attachment"}));
      }
      if(Number(event.member_observation_count||0)===0) {
        for(const team of localParticipants) exceptions.push(exceptionRow({team,type:"home_scores_visibility_gap",localState:"canonical final has no member game observation",authorityState:"Scores can see canonical but Home reads through attached games",recommendedRepair:"repair canonical member attachment, not read-path masking"}));
      }
    }
  }

  for(const row of candidates) {
    if(row.canonical_event_id==null && row.status==="FINAL" && row.team_score!=null && row.opponent_score!=null) {
      const team=teamById.get(row.team_id);
      if(team) exceptions.push(exceptionRow({team,type:"orphan_unmatched_final_observation",localState:`uncanonical FINAL vs ${row.opponent||row.opponent_school_id||"unknown"}`,authorityState:"record may count raw final but Home/Scores canonical truth is missing",recommendedRepair:"repair opponent identity or canonical reconciliation"}));
    }
  }

  const teamAuditById=new Map(teamAudit.map(row=>[row.team_id,row]));
  const publishedConferenceAudit=[];
  if(published) {
    for(const conference of published.conferences||[]) {
      let matched=0,membershipAligned=0,unmatched=0,ambiguous=0,overallAgrees=0,conferenceAgrees=0;
      for(const row of conference.standings||[]) {
        const matches=aliasIndex.get(normalizeSchoolAlias(row.school_name))||[];
        if(matches.length===0) {
          unmatched++;
          exceptions.push(exceptionRow({conference,type:"published_roster_unmatched",localState:"no unique local varsity volleyball team",authorityState:`published ${row.school_name} ${row.overall_record} (${row.conference_record} conf)`,recommendedRepair:"catalog/team identity review before membership materialization",details:{school_name:row.school_name,conference_id:`${conference.id}-volleyball`,conference_name:conference.name}}));
          continue;
        }
        if(matches.length!==1) {
          ambiguous++;
          exceptions.push(exceptionRow({conference,type:"published_roster_ambiguous",localState:`${matches.length} local candidates`,authorityState:`published ${row.school_name}`,recommendedRepair:"resolve school alias ambiguity; do not auto-assign conference",details:{school_name:row.school_name,candidate_team_ids:matches.map(team=>team.team_id),conference_id:`${conference.id}-volleyball`,conference_name:conference.name}}));
          continue;
        }
        matched++;
        const team=matches[0];
        const audit=teamAuditById.get(team.team_id);
        const expectedConferenceId=`${conference.id}-volleyball`;
        audit.published_standings_present=true;
        audit.published_overall_record=row.overall_record||null;
        audit.published_conference_record=row.conference_record||null;
        audit.overall_authority_agrees=audit.overall_record===row.overall_record;
        audit.conference_authority_agrees=audit.conference_record===row.conference_record;
        if(team.conference_id===expectedConferenceId) membershipAligned++;
        else exceptions.push(exceptionRow({team,conference:{...conference,id:expectedConferenceId},type:team.conference_id?"wrong_conference_membership":"missing_conference_membership",localState:team.conference_id||"NULL",authorityState:`published roster member of ${conference.name}`,recommendedRepair:"published volleyball conference roster sync"}));
        if(audit.overall_authority_agrees) overallAgrees++;
        else exceptions.push(exceptionRow({team,conference:{...conference,id:expectedConferenceId},type:"overall_record_authority_mismatch",localState:audit.overall_record,authorityState:row.overall_record,recommendedRepair:"compare authoritative finals to canonical schedule; repair missing/duplicate/reversed result before rebuilding record"}));
        if(audit.conference_authority_agrees) conferenceAgrees++;
        else exceptions.push(exceptionRow({team,conference:{...conference,id:expectedConferenceId},type:"conference_record_authority_mismatch",localState:audit.conference_record,authorityState:row.conference_record,recommendedRepair:"verify both memberships, record eligibility, and effective conference classification"}));
      }
      publishedConferenceAudit.push({
        conference_id:`${conference.id}-volleyball`,conference_name:conference.name,
        published_teams:(conference.standings||[]).length,matched_local_teams:matched,
        aligned_memberships:membershipAligned,unmatched,ambiguous,
        overall_records_agree:overallAgrees,conference_records_agree:conferenceAgrees,
        complete_local_membership:unmatched===0&&ambiguous===0&&membershipAligned===matched
      });
    }
  }

  const maxFinals=maxPreps?.matched||[];
  for(const final of maxFinals) {
    const key=pairDateKey(final.homeTeam.school_id,final.awayTeam.school_id,final.localDate);
    const localEvents=canonicalByPairDate.get(key)||[];
    if(localEvents.some(event=>canonicalMatchesAuthority(event,final))) continue;
    const affected=[final.homeTeam,final.awayTeam].map(match=>teamById.get(match.team_id)).filter(Boolean);
    let type="missing_externally_published_final";
    let localState="no canonical event for published final";
    if(localEvents.some(event=>event.status==="SCHEDULED")) {
      type="stale_scheduled_external_final";
      localState="canonical event remains SCHEDULED";
    } else if(localEvents.some(event=>event.status==="FINAL")) {
      type="external_final_score_conflict";
      localState=localEvents.map(event=>`${event.home_score}-${event.away_score}`).join(", ");
    }
    for(const team of affected) exceptions.push(exceptionRow({team,type,localState,authorityState:`MaxPreps FINAL ${final.home.name} ${final.home.score}-${final.away.score} ${final.away.name} on ${final.localDate}`,recommendedRepair:type==="external_final_score_conflict"?"apply authority hierarchy; inspect stronger-source evidence before changing canonical score":"permanent MaxPreps secondary result fallback / matcher repair",details:{contest_id:final.contestId,source_url:final.sourceUrl}}));
  }

  for(const ambiguous of maxPreps?.ambiguousFinals||[]) {
    const oneSide=oneSideAuthorityMatches(ambiguous,aliasIndex);
    if(oneSide) exceptions.push(exceptionRow({team:oneSide.team,type:"authority_final_unmatched_opponent",localState:`no unique local opponent identity for ${oneSide.opponent}`,authorityState:`MaxPreps FINAL ${ambiguous.home.name} ${ambiguous.home.score}-${ambiguous.away.score} ${ambiguous.away.name}`,recommendedRepair:"extend result matcher to preserve one-sided local team finals with safely resolved external opponent identity",details:{contest_id:ambiguous.contestId,source_url:ambiguous.sourceUrl}}));
  }

  const total=teamAudit.length;
  const summary={
    generated_at:generatedAt,
    active_arkansas_varsity_volleyball_teams:total,
    teams_with_schedules:teamAudit.filter(row=>row.schedule_games>0).length,
    teams_with_completed_games:teamAudit.filter(row=>row.completed_games>0).length,
    teams_with_overall_records:teamAudit.filter(row=>row.record_exists).length,
    teams_with_conference_membership:teamAudit.filter(row=>row.conference_id).length,
    teams_with_conference_records:teamAudit.filter(row=>row.record_exists&&row.conference_id).length,
    teams_represented_in_published_standings:teamAudit.filter(row=>row.published_standings_present).length,
    teams_overall_record_agrees_with_published:teamAudit.filter(row=>row.overall_authority_agrees===true).length,
    teams_conference_record_agrees_with_published:teamAudit.filter(row=>row.conference_authority_agrees===true).length,
    canonical_events:canonicals.length,
    canonical_finals:canonicals.filter(row=>row.status==="FINAL"&&row.home_score!=null&&row.away_score!=null).length,
    published_conferences:publishedConferenceAudit.length,
    conferences_with_complete_local_membership:publishedConferenceAudit.filter(row=>row.complete_local_membership).length,
    maxpreps_matched_finals:maxFinals.length,
    exception_count:exceptions.length
  };

  return {
    summary,
    conferences:publishedConferenceAudit,
    teams:teamAudit,
    exceptions_by_deficiency:groupExceptions(exceptions)
  };
}

function cachedFetch(fetchFn) {
  const cache=new Map();
  return async (url,init)=>{
    const key=String(url);
    if(!cache.has(key)) cache.set(key,Promise.resolve(fetchFn(url,init)));
    const response=await cache.get(key);
    return response.clone();
  };
}

export async function collectPublishedVolleyballAuthority(fetchFn=fetch) {
  const memoFetch=cachedFetch(fetchFn);
  const options=await listPublishedStandingsOptions({sport:SPORT,fetchFn:memoFetch});
  const conferences=[];
  const failures=[];
  for(let i=0;i<options.conferences.length;i+=AUTHORITY_BATCH_SIZE) {
    const batch=options.conferences.slice(i,i+AUTHORITY_BATCH_SIZE);
    const results=await Promise.all(batch.map(async conference=>{
      try {
        const parsed=await fetchPublishedStandings({sport:SPORT,conferenceId:conference.id,fetchFn:memoFetch});
        return {...conference,standings:parsed.standings||[]};
      } catch(error) {
        failures.push({conference_id:conference.id,error:String(error?.message||error)});
        return null;
      }
    }));
    conferences.push(...results.filter(Boolean));
  }
  return {conferences,failures};
}

export async function collectMaxPrepsVolleyballAuthority(localTeams,{fetchFn=fetch,startDate=SEASON_START,endDate=localDate(new Date())}={}) {
  const dates=dateRange(startDate,endDate);
  const matched=[];
  const ambiguous=[];
  const ambiguousFinals=[];
  const failures=[];
  let parsedFinals=0;
  for(let i=0;i<dates.length;i+=AUTHORITY_BATCH_SIZE) {
    const batch=dates.slice(i,i+AUTHORITY_BATCH_SIZE);
    const pages=await Promise.all(batch.map(async date=>{
      try {
        const url=maxPrepsScoresUrl(date);
        const response=await fetchFn(url,{headers:{"user-agent":"LocalBleachersAR-completeness-audit/1.0","accept":"text/html,application/xhtml+xml"}});
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        const finals=parseMaxPrepsVolleyballScores(await response.text(),{localDate:date,sourceUrl:response.url||url});
        return {date,finals};
      } catch(error) {
        failures.push({date,error:String(error?.message||error)});
        return {date,finals:[]};
      }
    }));
    for(const page of pages) {
      parsedFinals+=page.finals.length;
      const localMatch=matchLocalVolleyballTeams(page.finals,localTeams);
      matched.push(...localMatch.matched);
      ambiguous.push(...localMatch.ambiguous);
      const matchedIds=new Set(localMatch.matched.map(row=>row.contestId));
      ambiguousFinals.push(...page.finals.filter(row=>!matchedIds.has(row.contestId)));
    }
  }
  return {dates,parsedFinals,matched,ambiguous,ambiguousFinals,failures};
}

export async function loadVolleyballAuditSnapshot(env) {
  const statements=[
    env.DB.prepare(TEAM_SNAPSHOT_SQL),
    env.DB.prepare(CANONICAL_SNAPSHOT_SQL).bind(SEASON_START,SEASON_END_EXCLUSIVE),
    env.DB.prepare(SCHEDULE_CANDIDATE_SQL).bind(SEASON_START,SEASON_END_EXCLUSIVE,SEASON_START,SEASON_END_EXCLUSIVE)
  ];
  const results=await env.DB.batch(statements);
  const writes=results.reduce((sum,result)=>sum+rowsWritten(result),0);
  if(writes!==0) throw new Error(`volleyball completeness audit must be zero-write; observed rows_written=${writes}`);
  return {
    teams:results[0]?.results||[],
    canonicals:results[1]?.results||[],
    candidates:results[2]?.results||[],
    d1:{
      statements:3,
      rows_read:results.reduce((sum,result)=>sum+rowsRead(result),0),
      rows_written:writes,
      per_statement:results.map((result,index)=>({statement:index+1,rows_read:rowsRead(result),rows_written:rowsWritten(result)}))
    }
  };
}

export async function runVolleyballCompletenessAudit(env,{fetchFn=fetch,now=new Date()}={}) {
  const snapshot=await loadVolleyballAuditSnapshot(env);
  const auditDate=localDate(now);
  const [published,maxPreps]=await Promise.all([
    collectPublishedVolleyballAuthority(fetchFn),
    collectMaxPrepsVolleyballAuthority(snapshot.teams,{fetchFn,startDate:SEASON_START,endDate:auditDate})
  ]);
  return {
    ...buildVolleyballCompletenessAudit({
      teams:snapshot.teams,
      canonicals:snapshot.canonicals,
      candidates:snapshot.candidates,
      published,
      maxPreps,
      generatedAt:now.toISOString()
    }),
    d1:snapshot.d1,
    authority_fetch:{
      published_conference_failures:published.failures,
      maxpreps_dates:maxPreps.dates.length,
      maxpreps_parsed_finals:maxPreps.parsedFinals,
      maxpreps_ambiguous_matches:maxPreps.ambiguous.length,
      maxpreps_failures:maxPreps.failures
    }
  };
}

export {
  TEAM_SNAPSHOT_SQL,CANONICAL_SNAPSHOT_SQL,SCHEDULE_CANDIDATE_SQL,
  SEASON_START,SEASON_END_EXCLUSIVE,MAX_EXCEPTIONS_PER_TYPE,
  localDate,pairDateKey,recordText
};
