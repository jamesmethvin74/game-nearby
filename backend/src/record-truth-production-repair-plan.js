export const RECORD_TRUTH_REPAIR_CASES = Object.freeze([
  Object.freeze({
    key:"central-west-helena-forrest-city-20260825",
    repair_class:"partial-canonical-score",
    canonical_id:"ce:volleyball:girls:2026:df-7kza8c:df-cqpax3:20260825:df-695fcf130e0845562900001c",
    local_team_ids:["df-7kza8c-volleyball-2026","df-cqpax3-volleyball-2026"],
    authoritative_truth:{"df-7kza8c":{result:"W",score:3,opponent_score:0},"df-cqpax3":{result:"L",score:0,opponent_score:3}},
    execution:"existing-final-missing-score-repair"
  }),
  Object.freeze({
    key:"farmington-huntsville-20260825",
    repair_class:"partial-canonical-score",
    canonical_id:"ce:volleyball:girls:2026:df-8pkud7:df-qgka87:20260825:df-69babe474fd8441434000004",
    local_team_ids:["df-8pkud7-volleyball-2026","df-qgka87-volleyball-2026"],
    authoritative_truth:{"df-8pkud7":{result:"L",score:0,opponent_score:3},"df-qgka87":{result:"W",score:3,opponent_score:0}},
    execution:"existing-final-missing-score-repair"
  }),
  Object.freeze({
    key:"north-little-rock-beebe-20260824",
    repair_class:"poisoned-canonical",
    canonical_id:"ce:volleyball:girls:2026:df-hrdb8f:df-jufft8:20260824:t1630",
    authoritative_contest_ids:["eccd4ee4-19ba-4805-8f3e-76057b40f3e2"],
    local_team_ids:["df-hrdb8f-volleyball-2026","df-jufft8-volleyball-2026"],
    authoritative_truth:{"df-hrdb8f":{result:"L",score:0,opponent_score:3},"df-jufft8":{result:"W",score:3,opponent_score:0}},
    expected_home_school_id:"df-jufft8",
    expected_away_school_id:"df-hrdb8f",
    expected_home_score:3,
    expected_away_score:0,
    placeholder_rule:"Only FINAL volleyball observations with T 0-0 may be downgraded/detached as placeholders. Any other conflicting row aborts the repair."
  }),
  Object.freeze({
    key:"north-little-rock-lakeside-20260827",
    repair_class:"poisoned-canonical",
    canonical_id:"ce:volleyball:girls:2026:df-hrdb8f:df-vt4unv:20260827:df-695c0750c5e8bf402b000008",
    authoritative_contest_ids:["c15af614-2501-4437-ad9e-2a87b7d3b991"],
    local_team_ids:["df-hrdb8f-volleyball-2026","df-vt4unv-volleyball-2026"],
    authoritative_truth:{"df-hrdb8f":{result:"L",score:1,opponent_score:3},"df-vt4unv":{result:"W",score:3,opponent_score:1}},
    expected_home_school_id:"df-hrdb8f",
    expected_away_school_id:"df-vt4unv",
    expected_home_score:1,
    expected_away_score:3,
    placeholder_rule:"A contradictory source row may be overridden by canonical truth only when the fingerprinted authoritative MaxPreps final is present; unexpected explicit opposite-result evidence aborts."
  }),
  Object.freeze({
    key:"harrison-cotter-rematch-20260829",
    repair_class:"same-day-rematch-split",
    canonical_id:"ce:volleyball:girls:2026:df-ht8yyh:df-sz3b5e:20260829:mp-350185fc-ef8a-471b-a26e-1c9f04dfc231",
    authoritative_contest_ids:[
      "350185fc-ef8a-471b-a26e-1c9f04dfc231",
      "3fa66510-5b2b-47c8-b51a-642679c44b6a"
    ],
    local_team_ids:["df-ht8yyh-volleyball-2026","df-sz3b5e-volleyball-2026"],
    authoritative_truth:{
      "350185fc-ef8a-471b-a26e-1c9f04dfc231":{harrison:2,cotter:0},
      "3fa66510-5b2b-47c8-b51a-642679c44b6a":{harrison:3,cotter:1}
    },
    split_rule:"The first contest remains anchored to the existing canonical. Every member carrying the second native contest id must be detached and reconciled into a distinct canonical before records rebuild."
  }),
  Object.freeze({
    key:"cabot-blue-springs-south-rematch-20260829",
    repair_class:"same-day-rematch-split",
    canonical_id:"ce:volleyball:girls:2026:df-kq5hlr:mp-xe6tf6lf7uco1soenbisnw-7a263f82:20260829:mp-441a726d-4c94-4d68-bae8-4101f7d54446",
    authoritative_contest_ids:[
      "441a726d-4c94-4d68-bae8-4101f7d54446",
      "df6a4eed-d762-4c70-abe3-624fd7452bcc"
    ],
    local_team_ids:["df-kq5hlr-volleyball-2026"],
    authoritative_truth:{
      "441a726d-4c94-4d68-bae8-4101f7d54446":{cabot:2,blue_springs_south:0},
      "df6a4eed-d762-4c70-abe3-624fd7452bcc":{cabot:1,blue_springs_south:2}
    },
    split_rule:"The first contest remains anchored to the existing canonical. The second native contest id must be detached and reconciled into its own canonical; Blue Springs South remains opponent-only and does not receive a local team-record rebuild."
  })
]);

export const RECORD_TRUTH_REPAIR_TEAM_IDS = Object.freeze([
  ...new Set(RECORD_TRUTH_REPAIR_CASES.flatMap(item=>item.local_team_ids))
]);

export const RECORD_TRUTH_PRODUCTION_REPAIR_PLAN = Object.freeze({
  version:"record-truth-six-games-v1",
  approval_required:true,
  production_write_authorized:false,
  preflight:{
    statements_max:4,
    rows_read_max:300,
    rows_written:0,
    scope:"Only the six listed canonical ids, their members/game rows, exact authoritative native contest ids, active conflicts on those canonicals, and the ten listed local team_records rows.",
    fingerprint_required:true,
    fail_closed:true
  },
  execution:[
    "Run the existing final-missing-score fingerprinted repair for the Central West Helena/Forrest City and Huntsville/Farmington partial canonicals; it may update at most two canonical rows and rebuild exactly four local team records.",
    "For North Little Rock/Beebe, remove only fingerprinted T 0-0 volleyball placeholder contamination, set the canonical to Beebe 3 / North Little Rock 0 from native contest eccd4ee4-19ba-4805-8f3e-76057b40f3e2, then resolve/recompute only that event's result conflicts.",
    "For North Little Rock/Lakeside, set canonical truth to North Little Rock 1 / Lakeside 3 from native contest c15af614-2501-4437-ad9e-2a87b7d3b991; any unexpected explicit opposite-result observation aborts instead of being overwritten.",
    "For Harrison/Cotter, keep native contest 350185fc-ef8a-471b-a26e-1c9f04dfc231 as the 2-0 first match and detach native contest 3fa66510-5b2b-47c8-b51a-642679c44b6a into a separate 3-1 canonical before record rebuild.",
    "For Cabot/Blue Springs South, keep native contest 441a726d-4c94-4d68-bae8-4101f7d54446 as Cabot 2-0 and detach native contest df6a4eed-d762-4c70-abe3-624fd7452bcc into a separate Cabot 1-2 canonical before record rebuild.",
    "Rebuild only the ten listed local team records. Do not create a local team record for opponent-only Blue Springs South.",
    "Run one combined exact-scope verification query for the six repaired events/split rematches, their active conflicts, affected observations, and ten local team records. No statewide verification is part of this write step."
  ],
  write_fuses:{
    partial_canonical_direct_writes_max:2,
    placeholder_game_rows_max:4,
    rematch_member_detaches_max:8,
    rematch_new_canonicals_max:2,
    primary_canonical_repairs_max:4,
    local_team_record_rebuilds_max:10,
    abort_on_unexpected_member_or_score:true
  },
  postcondition:{
    all_six_truth_cases_resolved:true,
    active_result_score_conflicts_for_repaired_events:0,
    statewide_audit_not_included:true,
    final_statewide_audit_requires_separate_read_approval:true
  }
});

export function recordTruthProductionRepairPlan() {
  return {
    ...RECORD_TRUTH_PRODUCTION_REPAIR_PLAN,
    cases:RECORD_TRUTH_REPAIR_CASES,
    local_team_ids:RECORD_TRUTH_REPAIR_TEAM_IDS
  };
}
