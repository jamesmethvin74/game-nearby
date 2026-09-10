import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import {
  SEASON_START,
  SEASON_END_EXCLUSIVE,
  collectPublishedVolleyballAuthority,
  collectMaxPrepsVolleyballAuthority,
  buildVolleyballCompletenessAudit,
  localDate,
  pairDateKey
} from "./volleyball-completeness-audit.js";
import { loadFixedVolleyballAuditSnapshot } from "./volleyball-completeness-audit-runner.js";
import { buildVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

const SPORT="volleyball";
const GENDER="girls";
const SEASON="2026";
const MAX_DETAILS=50;

const CURRENT_CONFLICT_SQL=`
  WITH vb_schools AS (
    SELECT DISTINCT t.school_id
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
    SELECT ce.id,ce.participant_a_school_id,ce.participant_b_school_id,
      ce.status,ce.home_score,ce.away_score,ce.conflict_count
    FROM canonical_events ce
    WHERE ce.scheduled_at>=? AND ce.scheduled_at<?
      AND ce.sport='volleyball'
      AND ce.gender='girls'
      AND ce.season='2026'
      AND (
        ce.participant_a_school_id IN (SELECT school_id FROM vb_schools)
        OR ce.participant_b_school_id IN (SELECT school_id FROM vb_schools)
      )
  )
  SELECT se.id AS canonical_event_id,
    se.participant_a_school_id,se.participant_b_school_id,
    se.status,se.home_score,se.away_score,se.conflict_count,
    COALESCE(ec.conflict_type,'UNKNOWN') AS conflict_type,
    COUNT(ec.id) AS unresolved_rows
  FROM scoped_events se
  LEFT JOIN event_conflicts ec
    ON ec.canonical_event_id=se.id AND ec.resolved_at IS NULL
  WHERE se.conflict_count>0 OR ec.id IS NOT NULL
  GROUP BY se.id,se.participant_a_school_id,se.participant_b_school_id,
    se.status,se.home_score,se.away_score,se.conflict_count,
    COALESCE(ec.conflict_type,'UNKNOWN')
  ORDER BY se.id,conflict_type
`;

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

function auditedIdentityToken(teamId){
  return `localbleachers audit identity ${String(teamId||"").replace(/[^a-z0-9]+/gi," ")}`;
}

function localConferenceId(publishedId){
  return `${String(publishedId||"").trim().toLowerCase()}-volleyball`;
}

function teamAliases(team){
  return [...new Set([team.school_name,team.raw_school_name,team.location_matched_name]
    .map(normalizeSchoolAlias).filter(Boolean))];
}

export function applyPublishedVolleyballIdentityOverrides(published,teams=[]){
  const standingsByConference=new Map((published?.conferences||[]).map(conference=>[
    conference.id,{standings:conference.standings||[]}
  ]));
  const membership=buildVolleyballConferenceMembership({
    conferences:published?.conferences||[],
    standingsByConference,
    localTeams:teams
  });
  const teamById=new Map(teams.map(team=>[String(team.team_id),team]));
  const assignedByConference=new Map();
  for(const assignment of membership.assignments){
    if(!assignedByConference.has(assignment.conference_id)) assignedByConference.set(assignment.conference_id,[]);
    const team=teamById.get(String(assignment.team_id));
    if(team) assignedByConference.get(assignment.conference_id).push(team);
  }

  const tokenByTeam=new Map();
  const conferences=(published?.conferences||[]).map(conference=>{
    const assignments=assignedByConference.get(localConferenceId(conference.id))||[];
    const standings=(conference.standings||[]).map(row=>{
      const alias=normalizeSchoolAlias(row.school_name);
      if(!alias) return row;
      const candidates=assignments.filter(team=>teamAliases(team).includes(alias));
      if(candidates.length!==1) return row;
      const target=candidates[0];
      const token=auditedIdentityToken(target.team_id);
      tokenByTeam.set(String(target.team_id),token);
      return {...row,school_name:token};
    });
    return {...conference,standings};
  });
  const auditTeams=teams.map(team=>{
    const token=tokenByTeam.get(String(team.team_id));
    return token?{...team,location_matched_name:token}:team;
  });
  return {
    teams:auditTeams,
    published:{...published,conferences},
    applied_assignments:[...tokenByTeam.keys()],
    membership_unmatched:membership.unmatched,
    membership_ambiguous:membership.ambiguous
  };
}

function teamException(team,type,event,conflictTypes){
  const score=event.home_score==null||event.away_score==null
    ? String(event.status||"UNKNOWN")
    : `${event.status} ${event.home_score}-${event.away_score}`;
  return {
    school:team.school_name,
    team_id:team.team_id,
    conference:team.conference_name||null,
    conference_id:team.conference_id||null,
    deficiency_type:type,
    local_state:`canonical ${score}; current conflict types=${conflictTypes.join(",")}`,
    authority_state:type==="contradictory_final_score"
      ? "current unresolved SCORE evidence disagrees"
      : "current canonical observations disagree on non-score event metadata",
    recommended_repair:type==="contradictory_final_score"
      ? "apply authority hierarchy to current score observations before record rebuild"
      : "reconcile current event identity/metadata; do not treat this as a score contradiction",
    details:{canonical_event_id:event.canonical_event_id,conflict_types:conflictTypes}
  };
}

export function replaceLegacyConflictClassification(audit,conflictRows=[],teams=[]){
  const grouped={...(audit.exceptions_by_deficiency||{})};
  const legacyCount=Number(grouped.contradictory_final_score?.count||0);
  delete grouped.contradictory_final_score;

  const teamBySchool=new Map(teams.map(team=>[String(team.school_id),team]));
  const events=new Map();
  for(const row of conflictRows){
    if(!events.has(row.canonical_event_id)) events.set(row.canonical_event_id,{...row,types:new Set()});
    events.get(row.canonical_event_id).types.add(String(row.conflict_type||"UNKNOWN").toUpperCase());
  }

  const scoreExceptions=[];
  const reconciliationExceptions=[];
  for(const event of events.values()){
    const conflictTypes=[...event.types].sort();
    const hasScore=conflictTypes.includes("SCORE");
    const hasOther=conflictTypes.some(type=>type!=="SCORE");
    const participants=[event.participant_a_school_id,event.participant_b_school_id];
    for(const schoolId of participants){
      const team=teamBySchool.get(String(schoolId));
      if(!team) continue;
      if(hasScore) scoreExceptions.push(teamException(team,"contradictory_final_score",event,["SCORE"]));
      if(hasOther) reconciliationExceptions.push(teamException(team,"canonical_reconciliation_conflict",event,conflictTypes.filter(type=>type!=="SCORE")));
    }
  }

  if(scoreExceptions.length) grouped.contradictory_final_score={count:scoreExceptions.length,exceptions:scoreExceptions.slice(0,MAX_DETAILS)};
  if(reconciliationExceptions.length) grouped.canonical_reconciliation_conflict={count:reconciliationExceptions.length,exceptions:reconciliationExceptions.slice(0,MAX_DETAILS)};

  const replacementCount=scoreExceptions.length+reconciliationExceptions.length;
  return {
    ...audit,
    summary:{
      ...audit.summary,
      exception_count:Number(audit.summary?.exception_count||0)-legacyCount+replacementCount,
      current_score_conflict_team_exceptions:scoreExceptions.length,
      current_non_score_conflict_team_exceptions:reconciliationExceptions.length
    },
    exceptions_by_deficiency:grouped
  };
}

function scoreBySchool(event){
  return new Map([[String(event.home_school_id),Number(event.home_score)],[String(event.away_school_id),Number(event.away_score)]]);
}

function canonicalMatchesFinal(event,final){
  if(event.status!=="FINAL"||event.home_score==null||event.away_score==null) return false;
  const actual=scoreBySchool(event);
  return Number(actual.get(String(final.homeTeam.school_id)))===Number(final.home.score)
    && Number(actual.get(String(final.awayTeam.school_id)))===Number(final.away.score);
}

function localAliasIndex(teams){
  const index=new Map();
  for(const team of teams) for(const alias of teamAliases(team)){
    if(!index.has(alias)) index.set(alias,new Map());
    index.get(alias).set(String(team.team_id),team);
  }
  return new Map([...index].map(([alias,map])=>[alias,[...map.values()]]));
}

function oneSideLocalMatch(final,aliasIndex){
  const home=aliasIndex.get(normalizeSchoolAlias(final.home?.name))||[];
  const away=aliasIndex.get(normalizeSchoolAlias(final.away?.name))||[];
  if(home.length===1&&away.length===0) return {local:home[0],side:"home",opponent:final.away?.name||null};
  if(away.length===1&&home.length===0) return {local:away[0],side:"away",opponent:final.home?.name||null};
  return null;
}

function finalPlanRow(final,type,events=[]){
  return {
    type,
    local_date:final.localDate,
    contest_id:final.contestId,
    source_url:final.sourceUrl,
    home:{name:final.home?.name,score:Number(final.home?.score),team_id:final.homeTeam?.team_id||null,school_id:final.homeTeam?.school_id||null},
    away:{name:final.away?.name,score:Number(final.away?.score),team_id:final.awayTeam?.team_id||null,school_id:final.awayTeam?.school_id||null},
    local_canonical_events:events.map(event=>({id:event.canonical_event_id,status:event.status,home_score:event.home_score,away_score:event.away_score}))
  };
}

export function buildM7FinalGapPlan({teams=[],canonicals=[],maxPreps=null}={}){
  const canonicalByPairDate=new Map();
  for(const event of canonicals){
    const key=pairDateKey(event.participant_a_school_id,event.participant_b_school_id,localDate(event.scheduled_at));
    if(!canonicalByPairDate.has(key)) canonicalByPairDate.set(key,[]);
    canonicalByPairDate.get(key).push(event);
  }

  const matchedContestIds=new Set();
  const rows=[];
  for(const final of maxPreps?.matched||[]){
    matchedContestIds.add(String(final.contestId));
    const key=pairDateKey(final.homeTeam.school_id,final.awayTeam.school_id,final.localDate);
    const events=canonicalByPairDate.get(key)||[];
    if(events.some(event=>canonicalMatchesFinal(event,final))) continue;
    let type="missing_externally_published_final";
    if(events.some(event=>event.status==="SCHEDULED")) type="stale_scheduled_external_final";
    else if(events.some(event=>event.status==="FINAL")) type="external_final_score_conflict";
    rows.push(finalPlanRow(final,type,events));
  }

  const aliases=localAliasIndex(teams);
  let unresolvedIdentityFinals=0;
  for(const final of maxPreps?.ambiguousFinals||[]){
    if(matchedContestIds.has(String(final.contestId))) continue;
    const oneSide=oneSideLocalMatch(final,aliases);
    if(!oneSide){unresolvedIdentityFinals++;continue;}
    rows.push({
      type:"authority_final_unmatched_opponent",
      local_date:final.localDate,
      contest_id:final.contestId,
      source_url:final.sourceUrl,
      local_team_id:oneSide.local.team_id,
      local_school_id:oneSide.local.school_id,
      local_side:oneSide.side,
      opponent_name:oneSide.opponent,
      home:{name:final.home?.name,score:Number(final.home?.score)},
      away:{name:final.away?.name,score:Number(final.away?.score)},
      local_canonical_events:[]
    });
  }

  const unique=new Map();
  for(const row of rows) unique.set(`${row.type}|${row.contest_id}`,row);
  const exact=[...unique.values()].sort((a,b)=>String(a.local_date).localeCompare(String(b.local_date))||String(a.contest_id).localeCompare(String(b.contest_id)));
  const byDate=new Map();
  const byType={};
  for(const row of exact){
    byType[row.type]=(byType[row.type]||0)+1;
    if(!byDate.has(row.local_date)) byDate.set(row.local_date,{local_date:row.local_date,total:0,by_type:{},contest_ids:[],team_ids:new Set()});
    const bucket=byDate.get(row.local_date);
    bucket.total++;
    bucket.by_type[row.type]=(bucket.by_type[row.type]||0)+1;
    bucket.contest_ids.push(row.contest_id);
    for(const teamId of [row.local_team_id,row.home?.team_id,row.away?.team_id].filter(Boolean)) bucket.team_ids.add(teamId);
  }
  const dateCohorts=[...byDate.values()].map(row=>({...row,team_ids:[...row.team_ids].sort()}));
  return {
    unique_actionable_contests:exact.length,
    by_type:byType,
    unresolved_identity_finals:unresolvedIdentityFinals,
    date_cohorts:dateCohorts,
    exact_contests:exact
  };
}

async function loadCurrentConflictRows(env){
  const result=await env.DB.prepare(CURRENT_CONFLICT_SQL).bind(SEASON_START,SEASON_END_EXCLUSIVE).all();
  const written=rowsWritten(result);
  if(written!==0) throw new Error(`M7 conflict audit must be zero-write; observed rows_written=${written}`);
  return {rows:result.results||[],d1:{rows_read:rowsRead(result),rows_written:written}};
}

export async function runM7VolleyballCompletenessAudit(env,{fetchFn=fetch,now=new Date()}={}){
  const published=await collectPublishedVolleyballAuthority(fetchFn);
  if(!published.discoveryComplete) throw new Error(`published volleyball conference discovery incomplete: ${published.discoveredConferenceCount} conferences`);

  const snapshot=await loadFixedVolleyballAuditSnapshot(env);
  const maxPreps=await collectMaxPrepsVolleyballAuthority(snapshot.teams,{fetchFn,startDate:SEASON_START,endDate:localDate(now)});
  const identity=applyPublishedVolleyballIdentityOverrides(published,snapshot.teams);
  let audit=buildVolleyballCompletenessAudit({
    teams:identity.teams,
    canonicals:snapshot.canonicals,
    candidates:snapshot.candidates,
    published:identity.published,
    maxPreps,
    generatedAt:now.toISOString()
  });

  const conflicts=await loadCurrentConflictRows(env);
  audit=replaceLegacyConflictClassification(audit,conflicts.rows,identity.teams);
  const rowsReadTotal=Number(snapshot.d1.rows_read||0)+Number(conflicts.d1.rows_read||0);
  const rowsWrittenTotal=Number(snapshot.d1.rows_written||0)+Number(conflicts.d1.rows_written||0);
  if(rowsWrittenTotal!==0) throw new Error(`M7 completeness audit must be zero-write; observed rows_written=${rowsWrittenTotal}`);

  return {
    ...audit,
    d1:{
      statements:Number(snapshot.d1.statements||3)+1,
      rows_read:rowsReadTotal,
      rows_written:rowsWrittenTotal,
      per_statement:[...(snapshot.d1.per_statement||[]),{statement:4,rows_read:conflicts.d1.rows_read,rows_written:0}]
    },
    authority_fetch:{
      discovered_published_conferences:published.discoveredConferenceCount,
      published_conference_failures:published.failures,
      maxpreps_dates:maxPreps.dates.length,
      maxpreps_parsed_finals:maxPreps.parsedFinals,
      maxpreps_ambiguous_matches:maxPreps.ambiguous.length,
      maxpreps_failures:maxPreps.failures
    },
    audit_corrections:{
      published_identity_assignment_team_ids:identity.applied_assignments,
      membership_unmatched:identity.membership_unmatched,
      membership_ambiguous:identity.membership_ambiguous,
      conflict_classification:"SCORE conflicts separated from DATE/TIME/HOME_AWAY/VENUE/STATUS/metadata conflicts"
    },
    final_gap_plan:buildM7FinalGapPlan({teams:snapshot.teams,canonicals:snapshot.canonicals,maxPreps})
  };
}

export { CURRENT_CONFLICT_SQL, SPORT, GENDER, SEASON };
