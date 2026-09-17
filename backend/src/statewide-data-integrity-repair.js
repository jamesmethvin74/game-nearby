import { reconcileResolvedObservation } from "./canonical-observation-writer.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { PRESENTATION_SUPPRESSED_NOTE } from "./current-schedule-truth.js";

export const STATEWIDE_REPAIR_CODES=new Set([
  "SPLIT_CANONICAL_LOGICAL_GAME",
  "STALE_NONTERMINAL_TWIN_OF_FINAL",
  "DUPLICATE_SCHEDULE_ENTRY",
  "DISPLAY_FINAL_MISSING_SCORE",
  "PAST_DUE_NONTERMINAL_DISPLAY"
]);

const CANONICAL_REPAIR_CODES=new Set([
  "SPLIT_CANONICAL_LOGICAL_GAME",
  "STALE_NONTERMINAL_TWIN_OF_FINAL",
  "DUPLICATE_SCHEDULE_ENTRY"
]);

function blockingRepairIssues(audit={}) {
  return (audit.issues||[]).filter(issue=>issue?.severity==="blocking"&&STATEWIDE_REPAIR_CODES.has(issue.code));
}

export function buildStatewideRepairPlan(audit={},sources=[],{batchSize=16}={}) {
  const issues=blockingRepairIssues(audit);
  const affectedTeamIds=[...new Set(issues.map(issue=>String(issue.team_id||"")).filter(Boolean))];
  const affectedTeams=new Set(affectedTeamIds);
  const sourceIds=[...new Set((sources||[])
    .filter(source=>affectedTeams.has(String(source?.team_id||"")))
    .map(source=>String(source?.id||""))
    .filter(Boolean))];
  const issueCounts={};
  for(const issue of issues) issueCounts[issue.code]=(issueCounts[issue.code]||0)+1;
  const size=Math.max(1,Math.min(16,Number(batchSize)||16));
  const sourceBatches=[];
  for(let i=0;i<sourceIds.length;i+=size) sourceBatches.push(sourceIds.slice(i,i+size));
  return {
    issues,
    issueCounts,
    affectedTeamIds,
    sourceIds,
    sourceBatches,
    canonicalClusters:buildCanonicalRepairClusters(audit)
  };
}

export function buildCanonicalRepairClusters(audit={}) {
  const pairs=blockingRepairIssues(audit).filter(issue=>
    CANONICAL_REPAIR_CODES.has(issue.code)&&issue.game_id&&issue.other_game_id
  );
  const parent=new Map();
  const find=id=>{
    if(!parent.has(id)) parent.set(id,id);
    const p=parent.get(id);
    if(p!==id) parent.set(id,find(p));
    return parent.get(id);
  };
  const union=(a,b)=>{
    const ra=find(a),rb=find(b);
    if(ra!==rb) parent.set(rb,ra);
  };
  for(const issue of pairs) union(String(issue.game_id),String(issue.other_game_id));
  const clusters=new Map();
  for(const issue of pairs) {
    const root=find(String(issue.game_id));
    if(!clusters.has(root)) clusters.set(root,{gameIds:new Set(),teamIds:new Set(),codes:new Set()});
    const cluster=clusters.get(root);
    cluster.gameIds.add(String(issue.game_id));
    cluster.gameIds.add(String(issue.other_game_id));
    if(issue.team_id) cluster.teamIds.add(String(issue.team_id));
    cluster.codes.add(issue.code);
  }
  return [...clusters.values()].map(cluster=>({
    gameIds:[...cluster.gameIds],
    teamIds:[...cluster.teamIds],
    codes:[...cluster.codes].sort()
  }));
}

export async function loadAffectedTeamIdsForGameIds(env,gameIds=[]) {
  const ids=[...new Set((gameIds||[]).map(String).filter(Boolean))];
  if(!ids.length) return [];
  const {results=[]}=await env.DB.prepare(`
    WITH requested_games(id) AS (
      SELECT CAST(value AS TEXT)
      FROM json_each(?)
    )
    SELECT DISTINCT t.id AS reporting_team_id, opponent_team.id AS opponent_team_id
    FROM requested_games requested
    JOIN games g ON g.id=requested.id
    JOIN teams t ON t.id=g.team_id
    LEFT JOIN teams opponent_team
      ON opponent_team.school_id=g.opponent_school_id
     AND opponent_team.sport=t.sport
     AND opponent_team.gender=t.gender
     AND opponent_team.season=t.season`)
    .bind(JSON.stringify(ids)).all();
  return [...new Set(results.flatMap(row=>[row.reporting_team_id,row.opponent_team_id]).filter(value=>value!=null&&String(value)!=="").map(String))];
}

export async function reconcileAuditedCanonicalDefects(env,audit,{
  reconcile=reconcileResolvedObservation,
  rebuildRecords=rebuildTeamRecords,
  loadAffectedTeams=loadAffectedTeamIdsForGameIds
}={}) {
  const clusters=buildCanonicalRepairClusters(audit);
  const results=[];

  for(const cluster of clusters) {
    let canonicalEventId=null;
    let seedGameId=null;
    for(const gameId of cluster.gameIds) {
      canonicalEventId=await reconcile(env,gameId);
      if(canonicalEventId) {
        seedGameId=gameId;
        break;
      }
    }
    results.push({
      ...cluster,
      repaired:Boolean(canonicalEventId),
      seedGameId,
      canonicalEventId:canonicalEventId||null
    });
  }

  const repairedResults=results.filter(result=>result.repaired);
  const repairedGameIds=[...new Set(repairedResults.flatMap(result=>result.gameIds))];
  const auditedTeamIds=repairedResults.flatMap(result=>result.teamIds);
  const resolvedTeamIds=repairedGameIds.length?await loadAffectedTeams(env,repairedGameIds):[];
  const teamIds=[...new Set([...auditedTeamIds,...resolvedTeamIds].map(String).filter(Boolean))];
  const recordRebuild=teamIds.length
    ? await rebuildRecords(env,teamIds,new Date().toISOString())
    : {teams:0,scoredFinals:0,standings:{cohorts:0,standingsRows:0}};

  return {
    clustersExamined:clusters.length,
    clustersRepaired:repairedResults.length,
    affectedTeamIds:teamIds,
    results,
    recordRebuild
  };
}


function metaOf(result={}) {
  const meta=result?.meta||{};
  return {
    rows_read:meta.rows_read==null?0:Number(meta.rows_read),
    rows_written:meta.rows_written==null?0:Number(meta.rows_written),
    duration_ms:meta.duration==null?0:Number(meta.duration)
  };
}

function addMeta(total,result={}) {
  const meta=metaOf(result);
  total.rows_read+=meta.rows_read;
  total.rows_written+=meta.rows_written;
  total.duration_ms+=meta.duration_ms;
  total.statements++;
  return meta;
}

function completeCanonicalFinal(row={}) {
  return String(row.canonical_status||"").toUpperCase()==="FINAL"
    && row.canonical_home_score!=null
    && row.canonical_away_score!=null;
}

function completeRawFinal(row={}) {
  return String(row.raw_status||"").toUpperCase()==="FINAL"
    && row.raw_team_score!=null
    && row.raw_opponent_score!=null;
}

function canonicalCandidateScore(id,rows=[]) {
  let score=0;
  for(const row of rows) {
    if(String(row.canonical_event_id||"")!==id) continue;
    if(completeCanonicalFinal(row)) score=Math.max(score,10000);
    if(completeRawFinal(row)) score=Math.max(score,5000);
    if(Number(row.source_enabled)===1) score=Math.max(score,1000);
    const authority=Number(row.authority_rank);
    if(Number.isFinite(authority)) score=Math.max(score,Math.max(0,500-authority));
  }
  return score;
}

export function chooseCanonicalWinner(rows=[]) {
  const ids=[...new Set(rows.map(row=>String(row?.canonical_event_id||"")).filter(Boolean))];
  if(!ids.length) return null;
  return ids.sort((a,b)=>{
    const delta=canonicalCandidateScore(b,rows)-canonicalCandidateScore(a,rows);
    return delta || a.localeCompare(b);
  })[0];
}

function orientedRawFinal(row,winnerRow) {
  if(!completeRawFinal(row)||!winnerRow) return null;
  const school=String(row.reporting_school_id||"");
  const home=String(winnerRow.canonical_home_school_id||"");
  const away=String(winnerRow.canonical_away_school_id||"");
  if(!school||!home||!away) return null;
  if(school===home) return {home_score:Number(row.raw_team_score),away_score:Number(row.raw_opponent_score)};
  if(school===away) return {home_score:Number(row.raw_opponent_score),away_score:Number(row.raw_team_score)};
  return null;
}

function uniqueFinalPair(rows,winnerRow) {
  const pairs=new Map();
  for(const row of rows) {
    const pair=orientedRawFinal(row,winnerRow);
    if(!pair) continue;
    pairs.set(`${pair.home_score}:${pair.away_score}`,pair);
  }
  return pairs.size===1?[...pairs.values()][0]:null;
}

export function buildAuditedCanonicalMergePlan(audit={},rows=[]) {
  const byId=new Map((rows||[]).map(row=>[String(row.game_id||""),row]));
  const plans=[];
  for(const cluster of buildCanonicalRepairClusters(audit)) {
    const clusterRows=cluster.gameIds.map(id=>byId.get(String(id))).filter(Boolean);
    const winner=chooseCanonicalWinner(clusterRows);
    if(!winner) continue;
    const winnerRow=clusterRows.find(row=>String(row.canonical_event_id||"")===winner)||null;
    const loserCanonicalIds=[...new Set(clusterRows
      .map(row=>String(row.canonical_event_id||""))
      .filter(id=>id&&id!==winner))];
    const pair=completeCanonicalFinal(winnerRow)?null:uniqueFinalPair(clusterRows,winnerRow);
    plans.push({
      winner_canonical_id:winner,
      loser_canonical_ids:loserCanonicalIds,
      game_ids:[...new Set(cluster.gameIds.map(String))],
      team_ids:[...new Set(cluster.teamIds.map(String))],
      codes:[...cluster.codes],
      promote_final:pair
    });
  }
  return plans;
}

async function loadRepairRows(env,gameIds=[]) {
  const ids=[...new Set((gameIds||[]).map(String).filter(Boolean))];
  if(!ids.length) return {rows:[],meta:{rows_read:0,rows_written:0,duration_ms:0}};
  const result=await env.DB.prepare(`
    WITH requested(id) AS (
      SELECT CAST(value AS TEXT) FROM json_each(?)
    )
    SELECT
      g.id AS game_id,g.team_id,g.source_id,g.canonical_event_id,
      g.status AS raw_status,g.team_score AS raw_team_score,g.opponent_score AS raw_opponent_score,
      g.opponent_school_id,g.scheduled_at,g.notes,
      t.school_id AS reporting_school_id,t.sport,t.gender,t.season,
      src.enabled AS source_enabled,src.authority_rank,src.source_priority,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.scheduled_at AS canonical_scheduled_at,ce.selected_source_id,ce.trust_state
    FROM requested requested
    JOIN games g ON g.id=requested.id
    JOIN teams t ON t.id=g.team_id
    JOIN sources src ON src.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    ORDER BY g.id
  `).bind(JSON.stringify(ids)).all();
  return {rows:result?.results||[],meta:metaOf(result)};
}


async function applyCanonicalMergePlan(env,plans=[],checkedAt,total) {
  const canonicalMappings=[];
  const gameMappings=[];
  const promotions=[];
  for(const plan of plans) {
    for(const loser of plan.loser_canonical_ids) canonicalMappings.push({loser,winner:plan.winner_canonical_id});
    for(const gameId of plan.game_ids) gameMappings.push({game_id:gameId,winner:plan.winner_canonical_id});
    if(plan.promote_final) promotions.push({
      id:plan.winner_canonical_id,
      home_score:plan.promote_final.home_score,
      away_score:plan.promote_final.away_score
    });
  }

  if(canonicalMappings.length) {
    const json=JSON.stringify(canonicalMappings);
    addMeta(total,await env.DB.prepare(`
      WITH mapping(loser,winner) AS (
        SELECT json_extract(value,'$.loser'),json_extract(value,'$.winner') FROM json_each(?)
      )
      UPDATE games
      SET canonical_event_id=(SELECT winner FROM mapping WHERE loser=games.canonical_event_id),
          updated_at=?
      WHERE canonical_event_id IN (SELECT loser FROM mapping)
    `).bind(json,checkedAt).run());

    addMeta(total,await env.DB.prepare(`
      WITH mapping(loser,winner) AS (
        SELECT json_extract(value,'$.loser'),json_extract(value,'$.winner') FROM json_each(?)
      )
      UPDATE canonical_event_members
      SET canonical_event_id=(SELECT winner FROM mapping WHERE loser=canonical_event_members.canonical_event_id)
      WHERE canonical_event_id IN (SELECT loser FROM mapping)
    `).bind(json).run());

    addMeta(total,await env.DB.prepare(`
      WITH mapping(loser,winner) AS (
        SELECT json_extract(value,'$.loser'),json_extract(value,'$.winner') FROM json_each(?)
      )
      UPDATE event_conflicts
      SET canonical_event_id=(SELECT winner FROM mapping WHERE loser=event_conflicts.canonical_event_id)
      WHERE canonical_event_id IN (SELECT loser FROM mapping)
    `).bind(json).run());
  }

  if(gameMappings.length) {
    const json=JSON.stringify(gameMappings);
    addMeta(total,await env.DB.prepare(`
      WITH mapping(game_id,winner) AS (
        SELECT json_extract(value,'$.game_id'),json_extract(value,'$.winner') FROM json_each(?)
      )
      UPDATE games
      SET canonical_event_id=(SELECT winner FROM mapping WHERE game_id=games.id),
          updated_at=?
      WHERE id IN (SELECT game_id FROM mapping)
    `).bind(json,checkedAt).run());

    addMeta(total,await env.DB.prepare(`
      WITH mapping(game_id,winner) AS (
        SELECT json_extract(value,'$.game_id'),json_extract(value,'$.winner') FROM json_each(?)
      )
      INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
      SELECT mapping.winner,g.id,g.source_id,g.team_id,?
      FROM mapping JOIN games g ON g.id=mapping.game_id
    `).bind(json,checkedAt).run());
  }

  if(promotions.length) {
    addMeta(total,await env.DB.prepare(`
      WITH input(id,home_score,away_score) AS (
        SELECT json_extract(value,'$.id'),json_extract(value,'$.home_score'),json_extract(value,'$.away_score')
        FROM json_each(?)
      )
      UPDATE canonical_events
      SET status='FINAL',
          home_score=(SELECT home_score FROM input WHERE id=canonical_events.id),
          away_score=(SELECT away_score FROM input WHERE id=canonical_events.id),
          last_reconciled_at=?,
          updated_at=?
      WHERE id IN (SELECT id FROM input)
        AND NOT (status='FINAL' AND home_score IS NOT NULL AND away_score IS NOT NULL)
    `).bind(JSON.stringify(promotions),checkedAt,checkedAt).run());
  }

  if(canonicalMappings.length) {
    addMeta(total,await env.DB.prepare(`
      DELETE FROM canonical_events
      WHERE id IN (
        SELECT json_extract(value,'$.loser') FROM json_each(?)
      )
      AND NOT EXISTS (SELECT 1 FROM canonical_event_members cem WHERE cem.canonical_event_id=canonical_events.id)
      AND NOT EXISTS (SELECT 1 FROM event_conflicts ec WHERE ec.canonical_event_id=canonical_events.id)
    `).bind(JSON.stringify(canonicalMappings)).run());
  }

  return {
    clusters:plans.length,
    canonical_merges:canonicalMappings.length,
    game_reassignments:gameMappings.length,
    final_promotions:promotions.length
  };
}

async function promoteMissingFinalScores(env,audit,checkedAt,total) {
  const canonicalIds=[...new Set(blockingRepairIssues(audit)
    .filter(issue=>issue.code==="DISPLAY_FINAL_MISSING_SCORE")
    .map(issue=>String(issue.canonical_event_id||""))
    .filter(Boolean))];
  if(!canonicalIds.length) return {canonical_ids:[],promoted:[]};

  const result=await env.DB.prepare(`
    WITH requested(id) AS (SELECT CAST(value AS TEXT) FROM json_each(?))
    SELECT
      ce.id AS canonical_event_id,ce.status AS canonical_status,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      g.id AS game_id,g.status AS raw_status,g.team_score AS raw_team_score,g.opponent_score AS raw_opponent_score,
      t.school_id AS reporting_school_id
    FROM requested requested
    JOIN canonical_events ce ON ce.id=requested.id
    JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
    JOIN games g ON g.id=cem.game_id
    JOIN teams t ON t.id=g.team_id
    ORDER BY ce.id,g.id
  `).bind(JSON.stringify(canonicalIds)).all();
  addMeta(total,result);

  const byCanonical=new Map();
  for(const row of result?.results||[]) {
    if(!byCanonical.has(row.canonical_event_id)) byCanonical.set(row.canonical_event_id,[]);
    byCanonical.get(row.canonical_event_id).push(row);
  }
  const promoted=[];
  for(const [id,rows] of byCanonical) {
    const winnerRow=rows[0];
    const pair=uniqueFinalPair(rows,winnerRow);
    if(pair) promoted.push({id,home_score:pair.home_score,away_score:pair.away_score});
  }
  if(promoted.length) {
    addMeta(total,await env.DB.prepare(`
      WITH input(id,home_score,away_score) AS (
        SELECT json_extract(value,'$.id'),json_extract(value,'$.home_score'),json_extract(value,'$.away_score')
        FROM json_each(?)
      )
      UPDATE canonical_events
      SET status='FINAL',
          home_score=(SELECT home_score FROM input WHERE id=canonical_events.id),
          away_score=(SELECT away_score FROM input WHERE id=canonical_events.id),
          last_reconciled_at=?,
          updated_at=?
      WHERE id IN (SELECT id FROM input)
        AND (home_score IS NULL OR away_score IS NULL OR status<>'FINAL')
    `).bind(JSON.stringify(promoted),checkedAt,checkedAt).run());
  }
  return {canonical_ids:canonicalIds,promoted};
}

async function memberGameIdsForCanonicalIds(env,canonicalIds=[],total=null) {
  const ids=[...new Set(canonicalIds.map(String).filter(Boolean))];
  if(!ids.length) return [];
  const result=await env.DB.prepare(`
    SELECT game_id FROM canonical_event_members
    WHERE canonical_event_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
  `).bind(JSON.stringify(ids)).all();
  if(total) addMeta(total,result);
  return [...new Set((result?.results||[]).map(row=>String(row.game_id||"")).filter(Boolean))];
}

function suppressionTargetsFromAudit(audit={}) {
  const ids=new Set();
  const unresolvedCanonicalIds=new Set();
  for(const issue of blockingRepairIssues(audit)) {
    if(issue.code==="PAST_DUE_NONTERMINAL_DISPLAY" || issue.code==="STALE_NONTERMINAL_TWIN_OF_FINAL") {
      if(issue.game_id) ids.add(String(issue.game_id));
    } else if(issue.code==="DISPLAY_FINAL_MISSING_SCORE") {
      if(issue.canonical_event_id) unresolvedCanonicalIds.add(String(issue.canonical_event_id));
      else if(issue.game_id) ids.add(String(issue.game_id));
    } else if(issue.code==="SPLIT_CANONICAL_LOGICAL_GAME" || issue.code==="DUPLICATE_SCHEDULE_ENTRY") {
      if(issue.game_id) ids.add(String(issue.game_id));
    }
  }
  return {gameIds:[...ids],canonicalIds:[...unresolvedCanonicalIds]};
}

async function suppressPresentationRows(env,gameIds=[],checkedAt,total) {
  const ids=[...new Set(gameIds.map(String).filter(Boolean))];
  if(!ids.length) return {game_ids:[],rows_written:0};
  const result=await env.DB.prepare(`
    UPDATE games
    SET notes=CASE
          WHEN instr(COALESCE(notes,''),?)>0 THEN notes
          WHEN notes IS NULL OR notes='' THEN ?
          ELSE notes || ' | ' || ?
        END,
        updated_at=?
    WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      AND instr(COALESCE(notes,''),?)=0
  `).bind(PRESENTATION_SUPPRESSED_NOTE,PRESENTATION_SUPPRESSED_NOTE,PRESENTATION_SUPPRESSED_NOTE,checkedAt,JSON.stringify(ids),PRESENTATION_SUPPRESSED_NOTE).run();
  const meta=addMeta(total,result);
  return {game_ids:ids,rows_written:meta.rows_written};
}

export async function repairAuditedPresentationDefects(env,audit,{
  now=new Date(),
  rebuildRecords=rebuildTeamRecords,
  rebuildAudit=null
}={}) {
  if(typeof rebuildAudit!=="function") throw new Error("repairAuditedPresentationDefects requires rebuildAudit");
  const checkedAt=now.toISOString();
  const initialIssues=blockingRepairIssues(audit);
  const initialGameIds=[...new Set(initialIssues.flatMap(issue=>[issue.game_id,issue.other_game_id]).filter(value=>value!=null&&String(value)!=="").map(String))];
  const loaded=await loadRepairRows(env,initialGameIds);
  const d1={statements:1,rows_read:loaded.meta.rows_read,rows_written:loaded.meta.rows_written,duration_ms:loaded.meta.duration_ms};
  const mergePlan=buildAuditedCanonicalMergePlan(audit,loaded.rows);
  const mergeResult=await applyCanonicalMergePlan(env,mergePlan,checkedAt,d1);

  const afterMerge=await rebuildAudit();
  const scoreRepair=await promoteMissingFinalScores(env,afterMerge,checkedAt,d1);
  const afterScore=scoreRepair.promoted.length?await rebuildAudit():afterMerge;

  const targets=suppressionTargetsFromAudit(afterScore);
  const memberIds=await memberGameIdsForCanonicalIds(env,targets.canonicalIds,d1);
  const suppressIds=[...new Set([...targets.gameIds,...memberIds])];

  const affectedBefore=[...new Set([...initialGameIds,...suppressIds])];
  const affectedTeamIds=await loadAffectedTeamIdsForGameIds(env,affectedBefore);
  const suppression=await suppressPresentationRows(env,suppressIds,checkedAt,d1);
  const recordRebuild=affectedTeamIds.length
    ? await rebuildRecords(env,affectedTeamIds,checkedAt)
    : {teams:0,scoredFinals:0,standings:{cohorts:0,standingsRows:0}};
  const after=await rebuildAudit();

  return {
    status:"EXECUTED",
    before_blocking:initialIssues.length,
    canonical:mergeResult,
    score_repair:{
      canonical_ids:scoreRepair.canonical_ids,
      promoted:scoreRepair.promoted
    },
    suppression,
    affected_team_ids:affectedTeamIds,
    record_rebuild:recordRebuild,
    after_summary:after.summary,
    after_issue_counts:Object.fromEntries(Object.entries(after.summary?.issues_by_code||{})),
    d1
  };
}
