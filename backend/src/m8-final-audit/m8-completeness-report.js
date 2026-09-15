const CATEGORY_RULES = [
  {
    id:"source_result_ambiguity",
    label:"provider result surfaces disagree",
    codes:new Set(["SOURCE_RESULT_AMBIGUITY"]),
    actionable:true,
    systemic_fix_available:"provider_resolution_required",
    requires_source_recovery:true,
    legitimate_expected_gap:true
  },
  {
    id:"source_completeness_gap",
    label:"source snapshot exceeds stored rows",
    codes:new Set(["SOURCE_COMPLETENESS_GAP"]),
    actionable:true,
    systemic_fix_available:true,
    requires_source_recovery:true,
    legitimate_expected_gap:false
  },
  {
    id:"past_due_nonterminal",
    label:"past-due record game is still nonterminal",
    codes:new Set(["PAST_DUE_NONTERMINAL"]),
    actionable:true,
    systemic_fix_available:"depends_on_source",
    requires_source_recovery:true,
    legitimate_expected_gap:false
  },
  {
    id:"record_ahead_of_final_evidence",
    label:"stored/published overall record covers more games than final evidence",
    codes:new Set(["STORED_RECORD_EXCEEDS_FINAL_EVIDENCE","PUBLISHED_RECORD_EXCEEDS_FINAL_EVIDENCE"]),
    actionable:true,
    systemic_fix_available:"depends_on_missing_result_recovery",
    requires_source_recovery:true,
    legitimate_expected_gap:false
  },
  {
    id:"conference_record_ahead_of_final_evidence",
    label:"stored/published conference record covers more games than final evidence",
    codes:new Set(["STORED_CONFERENCE_RECORD_EXCEEDS_FINAL_EVIDENCE","PUBLISHED_CONFERENCE_RECORD_EXCEEDS_FINAL_EVIDENCE"]),
    actionable:true,
    systemic_fix_available:"depends_on_conference_evidence",
    requires_source_recovery:true,
    legitimate_expected_gap:false
  }
];

const OTHER_CATEGORY = {
  id:"other_incomplete",
  label:"other blocking completeness evidence",
  actionable:true,
  systemic_fix_available:"unknown",
  requires_source_recovery:"unknown",
  legitimate_expected_gap:false
};

function pct(numerator,denominator) {
  if (!denominator) return 0;
  return Math.round((10000*numerator)/denominator)/100;
}

function blockingIssues(team) {
  return (team.issues || []).filter(issue=>issue.severity === "blocking" && issue.resolved !== true);
}

function primaryCategory(team) {
  const codes=new Set(blockingIssues(team).map(issue=>issue.code));
  return CATEGORY_RULES.find(rule=>[...rule.codes].some(code=>codes.has(code))) || OTHER_CATEGORY;
}

function issueEventKey(team,issue) {
  return issue.canonical_event_id || issue.game_id || null;
}

function estimatedGap(issue) {
  const detail=String(issue?.detail || "");
  let match=detail.match(/covers\s+(\d+)\s+games[^\d]+covers\s+(\d+)/i);
  if (match) return Math.max(0,Number(match[1])-Number(match[2]));
  match=detail.match(/reported\s+(\d+)\s+games\s+but\s+(\d+)\s+rows/i);
  if (match) return Math.max(0,Number(match[1])-Number(match[2]));
  return 0;
}

function sourceFamily(team,sourceId) {
  if (!sourceId) return "record cross-check / no source row";
  const value=String(sourceId).toLowerCase();
  if (value.includes("dragonfly")) return "DragonFly";
  if (value.includes("maxpreps")) return "MaxPreps";
  if (value.includes("hooten")) return "Hooten";
  if (value.includes("official-school") || value.includes("mascot")) return "Mascot / official-school";
  if (team.level === "college" || value.includes("sidearm") || value.includes("presto")) return "college official athletics";
  if (value.includes("official")) return "official-school / other";
  return "other active production source";
}

function summarizeTeams(teams) {
  const classifications={VERIFIED:0,INCOMPLETE:0,UNRESOLVED:0,CONTRADICTORY:0};
  for (const team of teams) {
    if (Object.prototype.hasOwnProperty.call(classifications,team.classification)) classifications[team.classification]++;
  }
  const withFinals=teams.filter(team=>Number(team.evidence_games || 0)>0).length;
  const publicVerified=teams.filter(team=>team.public_record_verified === true).length;
  return {
    team_count:teams.length,
    teams_with_completed_games:withFinals,
    public_record_verified_teams:publicVerified,
    teams_with_zero_trustworthy_final_evidence:teams.length-withFinals,
    record_evidence_coverage_percentage:pct(withFinals,teams.length),
    public_record_verification_percentage_among_completed:pct(publicVerified,withFinals),
    classifications
  };
}

function groupedTeamSummary(teams,key) {
  const groups=new Map();
  for (const team of teams) {
    const value=String(team?.[key] || "unknown").toLowerCase();
    if (!groups.has(value)) groups.set(value,[]);
    groups.get(value).push(team);
  }
  return Object.fromEntries([...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>[name,summarizeTeams(rows)]));
}

function failureBreakdown(incompleteTeams) {
  const groups=new Map();
  for (const team of incompleteTeams) {
    const category=primaryCategory(team);
    if (!groups.has(category.id)) groups.set(category.id,{category,teams:new Map(),events:new Set(),estimated_missing_games:0,sports:new Map(),sources:new Map()});
    const group=groups.get(category.id);
    group.teams.set(team.team_id,team);
    group.sports.set(team.sport,(group.sports.get(team.sport)||0)+1);
    const relevant=blockingIssues(team).filter(issue=>category===OTHER_CATEGORY || category.codes?.has(issue.code));
    for (const issue of relevant) {
      const eventKey=issueEventKey(team,issue);
      if (eventKey) group.events.add(eventKey);
      else group.estimated_missing_games+=estimatedGap(issue);
      const family=sourceFamily(team,issue.source_id);
      if (!group.sources.has(family)) group.sources.set(family,{teams:new Set(),events:new Set(),issue_count:0});
      const source=group.sources.get(family);
      source.teams.add(team.team_id);
      if (eventKey) source.events.add(eventKey);
      source.issue_count++;
    }
  }
  return [...groups.values()].map(group=>({
    category:group.category.id,
    description:group.category.label,
    team_count:group.teams.size,
    game_count:group.events.size+group.estimated_missing_games,
    sport:Object.fromEntries([...group.sports.entries()].sort(([a],[b])=>String(a).localeCompare(String(b)))),
    source:Object.fromEntries([...group.sources.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>[name,{team_count:value.teams.size,game_count:value.events.size,issue_count:value.issue_count}])),
    actionable:group.category.actionable,
    systemic_fix_available:group.category.systemic_fix_available,
    requires_source_recovery:group.category.requires_source_recovery,
    legitimate_expected_gap:group.category.legitimate_expected_gap
  })).sort((a,b)=>b.team_count-a.team_count || a.category.localeCompare(b.category));
}

function sourceBreakdown(incompleteTeams) {
  const groups=new Map();
  for (const team of incompleteTeams) {
    for (const issue of blockingIssues(team)) {
      const family=sourceFamily(team,issue.source_id);
      if (!groups.has(family)) groups.set(family,{teams:new Set(),events:new Set(),estimated_missing_games:0,issues:0,sports:new Map(),categories:new Map()});
      const group=groups.get(family);
      group.teams.add(team.team_id);
      const eventKey=issueEventKey(team,issue);
      if (eventKey) group.events.add(eventKey);
      else group.estimated_missing_games+=estimatedGap(issue);
      group.issues++;
      group.sports.set(team.sport,(group.sports.get(team.sport)||0)+1);
      const category=primaryCategory(team).id;
      group.categories.set(category,(group.categories.get(category)||0)+1);
    }
  }
  return Object.fromEntries([...groups.entries()].sort(([,a],[,b])=>b.teams.size-a.teams.size).map(([name,group])=>[name,{
    team_count:group.teams.size,
    game_count:group.events.size+group.estimated_missing_games,
    issue_count:group.issues,
    sport:Object.fromEntries(group.sports),
    primary_failure_categories:Object.fromEntries(group.categories)
  }]));
}

function unresolvedDetails(teams) {
  return teams.filter(team=>team.classification === "UNRESOLVED").map(team=>({
    team_id:team.team_id,
    school_id:team.school_id,
    school_name:team.school_name,
    level:team.level,
    sport:team.sport,
    gender:team.gender,
    unresolved_finals:Number(team.unresolved_finals || 0),
    blockers:blockingIssues(team).map(issue=>({
      code:issue.code,
      source_id:issue.source_id || null,
      game_id:issue.game_id || null,
      canonical_event_id:issue.canonical_event_id || null,
      detail:issue.detail || null
    }))
  })).sort((a,b)=>String(a.school_name).localeCompare(String(b.school_name)) || String(a.sport).localeCompare(String(b.sport)));
}

export function buildM8CompletenessReport(audit={}) {
  const teams=Array.isArray(audit.teams)?audit.teams:[];
  const summary=audit.summary || {};
  const incomplete=teams.filter(team=>team.classification === "INCOMPLETE");
  const withFinals=teams.filter(team=>Number(team.evidence_games || 0)>0).length;
  const publicVerified=teams.filter(team=>team.public_record_verified === true).length;
  const requiringAudit=Number(summary.total_active_teams_requiring_record_audit || 0);
  const auditedVerified=Number(summary.verified || 0);
  const categories=failureBreakdown(incomplete);

  return {
    generated_at:audit.generated_at || new Date().toISOString(),
    definition:{
      completeness_percentage:"audited VERIFIED teams / teams requiring record audit",
      record_evidence_coverage_percentage:"active teams with at least one normalized countable FINAL / all active teams",
      public_record_verification_percentage_among_completed:"teams whose public record is verified / active teams with normalized countable FINAL evidence",
      gap_policy:"A zero-final-evidence team is reported separately and is not automatically labeled defective. INCOMPLETE teams are classified by their blocking evidence."
    },
    overall:{
      total_active_teams:teams.length,
      teams_with_completed_games:withFinals,
      teams_requiring_record_audit:requiringAudit,
      verified_teams:auditedVerified,
      incomplete_teams:Number(summary.incomplete || incomplete.length),
      unresolved_teams:Number(summary.unresolved || teams.filter(team=>team.classification === "UNRESOLVED").length),
      contradictory_teams:Number(summary.contradictory || teams.filter(team=>team.classification === "CONTRADICTORY").length),
      teams_with_zero_trustworthy_final_evidence:teams.length-withFinals,
      public_record_verified_teams:publicVerified,
      completeness_percentage:pct(auditedVerified,requiringAudit),
      record_evidence_coverage_percentage:pct(withFinals,teams.length),
      public_record_verification_percentage_among_completed:pct(publicVerified,withFinals),
      unexplained_record_contradictions:Number(summary.unexplained_record_contradictions || 0)
    },
    by_sport:groupedTeamSummary(teams,"sport"),
    by_level:groupedTeamSummary(teams,"level"),
    by_source:sourceBreakdown(incomplete),
    by_failure_category:categories,
    incomplete_accounting:{
      classified_incomplete_teams:categories.reduce((sum,row)=>sum+row.team_count,0),
      audit_incomplete_teams:incomplete.length,
      all_incomplete_teams_have_primary_reason:categories.reduce((sum,row)=>sum+row.team_count,0)===incomplete.length,
      actionable_incomplete_teams:categories.filter(row=>row.actionable===true).reduce((sum,row)=>sum+row.team_count,0),
      systemic_bug_teams:categories.filter(row=>row.systemic_fix_available===true).reduce((sum,row)=>sum+row.team_count,0),
      source_recovery_teams:categories.filter(row=>row.requires_source_recovery===true).reduce((sum,row)=>sum+row.team_count,0),
      legitimate_expected_gap_teams:categories.filter(row=>row.legitimate_expected_gap===true).reduce((sum,row)=>sum+row.team_count,0)
    },
    unresolved_final_details:unresolvedDetails(teams)
  };
}

export { CATEGORY_RULES, primaryCategory, sourceFamily };
