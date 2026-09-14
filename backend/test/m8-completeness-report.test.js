import test from "node:test";
import assert from "node:assert/strict";
import { buildM8CompletenessReport, sourceFamily } from "../src/m8-completeness-report.js";

function team({
  id,
  level="high-school",
  sport="football",
  classification="VERIFIED",
  evidence=0,
  publicVerified=false,
  issues=[]
}) {
  return {
    team_id:id,
    school_id:id,
    school_name:id,
    level,
    sport,
    gender:sport === "volleyball" ? "girls" : "boys",
    classification,
    evidence_games:evidence,
    public_record_verified:publicVerified,
    unresolved_finals:classification === "UNRESOLVED" ? 1 : 0,
    issues
  };
}

const blocking=(code,extra={})=>({code,severity:"blocking",resolved:false,...extra});

test("statewide report accounts for every incomplete team with one primary reason", () => {
  const audit={
    generated_at:"2026-09-14T18:41:47.702Z",
    summary:{
      total_active_teams_examined:6,
      total_active_teams_with_finals:3,
      total_active_teams_requiring_record_audit:5,
      verified:1,
      incomplete:3,
      unresolved:1,
      contradictory:0,
      unexplained_record_contradictions:0
    },
    teams:[
      team({id:"past-due",classification:"INCOMPLETE",evidence:1,issues:[blocking("PAST_DUE_NONTERMINAL",{source_id:"dragonfly-statewide-football",game_id:"g1"})]}),
      team({id:"conference-gap",classification:"INCOMPLETE",sport:"volleyball",evidence:1,issues:[blocking("STORED_CONFERENCE_RECORD_EXCEEDS_FINAL_EVIDENCE",{detail:"Stored conference record covers 3 games; normalized conference final evidence covers 2."})]}),
      team({id:"source-gap",classification:"INCOMPLETE",sport:"volleyball",issues:[blocking("SOURCE_COMPLETENESS_GAP",{source_id:"school-volleyball-official-school",detail:"source last successful snapshot reported 4 games but 3 rows are currently stored for that source."})]}),
      team({id:"future-only",sport:"basketball"}),
      team({id:"verified-final",evidence:1,publicVerified:true}),
      team({id:"unresolved",classification:"UNRESOLVED",sport:"volleyball",issues:[blocking("FINAL_MISSING_SCORE",{source_id:"maxpreps-volleyball",game_id:"u1"})]})
    ]
  };

  const report=buildM8CompletenessReport(audit);
  assert.equal(report.overall.total_active_teams,6);
  assert.equal(report.overall.teams_with_completed_games,3);
  assert.equal(report.overall.teams_with_zero_trustworthy_final_evidence,3);
  assert.equal(report.overall.completeness_percentage,20);
  assert.equal(report.overall.record_evidence_coverage_percentage,50);
  assert.equal(report.overall.public_record_verification_percentage_among_completed,33.33);

  assert.equal(report.incomplete_accounting.audit_incomplete_teams,3);
  assert.equal(report.incomplete_accounting.classified_incomplete_teams,3);
  assert.equal(report.incomplete_accounting.all_incomplete_teams_have_primary_reason,true);

  const categories=Object.fromEntries(report.by_failure_category.map(row=>[row.category,row]));
  assert.equal(categories.past_due_nonterminal.team_count,1);
  assert.equal(categories.past_due_nonterminal.game_count,1);
  assert.equal(categories.conference_record_ahead_of_final_evidence.team_count,1);
  assert.equal(categories.conference_record_ahead_of_final_evidence.game_count,1);
  assert.equal(categories.source_completeness_gap.team_count,1);
  assert.equal(categories.source_completeness_gap.game_count,1);

  assert.equal(report.by_source.DragonFly.team_count,1);
  assert.equal(report.by_source["Mascot / official-school"].team_count,1);
  assert.equal(report.by_source["record cross-check / no source row"].team_count,1);
  assert.equal(report.unresolved_final_details.length,1);
  assert.equal(report.unresolved_final_details[0].blockers[0].code,"FINAL_MISSING_SCORE");
});

test("college source rows roll up under college official athletics", () => {
  assert.equal(sourceFamily({level:"college"},"college-uark-basketball-men-2026-sidearm"),"college official athletics");
  assert.equal(sourceFamily({level:"college"},"college-uca-volleyball-official"),"college official athletics");
});
