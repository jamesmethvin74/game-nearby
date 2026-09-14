export const RECORD_TRUTH_REPAIR_CASES = Object.freeze([
  Object.freeze({
    key:"central-west-helena-forrest-city-20260825",
    repair_class:"already-repaired-partial-canonical",
    canonical_id:"ce:volleyball:girls:2026:df-7kza8c:df-cqpax3:20260825:df-695fcf130e0845562900001c",
    local_team_ids:["df-7kza8c-volleyball-2026","df-cqpax3-volleyball-2026"],
    authoritative_truth:{"df-7kza8c":{result:"W",score:3,opponent_score:0},"df-cqpax3":{result:"L",score:0,opponent_score:3}},
    execution:"already-repaired-by-approved-final-missing-score-v2"
  }),
  Object.freeze({
    key:"farmington-huntsville-20260825",
    repair_class:"already-repaired-partial-canonical",
    canonical_id:"ce:volleyball:girls:2026:df-8pkud7:df-qgka87:20260825:df-69babe474fd8441434000004",
    local_team_ids:["df-8pkud7-volleyball-2026","df-qgka87-volleyball-2026"],
    authoritative_truth:{"df-8pkud7":{result:"L",score:0,opponent_score:3},"df-qgka87":{result:"W",score:3,opponent_score:0}},
    execution:"already-repaired-by-approved-final-missing-score-v2"
  }),
  Object.freeze({
    key:"north-little-rock-beebe-20260824",
    repair_class:"poisoned-canonical",
    canonical_id:"ce:volleyball:girls:2026:df-hrdb8f:df-jufft8:20260824:t1630",
    authoritative_contest_ids:["eccd4ee4-19ba-4805-8f3e-76057b40f3e2"],
    authoritative_game_ids:[
      "maxpreps-volleyball-results:df-hrdb8f-volleyball-2026:native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2",
      "maxpreps-volleyball-results:df-jufft8-volleyball-2026:native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2"
    ],
    placeholder_game_id:"df-hrdb8f-volleyball-2026-official-school-results:beebe|away|1",
    local_team_ids:["df-hrdb8f-volleyball-2026","df-jufft8-volleyball-2026"],
    authoritative_truth:{"df-hrdb8f":{result:"L",score:0,opponent_score:3},"df-jufft8":{result:"W",score:3,opponent_score:0}},
    expected_home_school_id:"df-jufft8",
    expected_away_school_id:"df-hrdb8f",
    expected_home_score:3,
    expected_away_score:0,
    execution:"repair-one-canonical-and-one-placeholder",
    placeholder_rule:"Only the exact FINAL volleyball Mascot T 0-0 placeholder may be downgraded to non-record SCHEDULED. Any other conflicting member aborts."
  }),
  Object.freeze({
    key:"north-little-rock-lakeside-20260827",
    repair_class:"corroborated-canonical-verification",
    canonical_id:"ce:volleyball:girls:2026:df-hrdb8f:df-vt4unv:20260827:df-695c0750c5e8bf402b000008",
    authoritative_contest_ids:["695c0750c5e8bf402b000008"],
    authoritative_game_ids:[
      "df-hrdb8f-volleyball-2026-dragonfly-statewide:native:695c0750c5e8bf402b000008",
      "df-hrdb8f-volleyball-2026-dragonfly:native:695c0750c5e8bf402b000008",
      "df-vt4unv-volleyball-2026-dragonfly-statewide:native:695c0750c5e8bf402b000008",
      "df-vt4unv-volleyball-2026-dragonfly:native:695c0750c5e8bf402b000008"
    ],
    local_team_ids:["df-hrdb8f-volleyball-2026","df-vt4unv-volleyball-2026"],
    authoritative_truth:{"df-hrdb8f":{result:"L",score:1,opponent_score:3},"df-vt4unv":{result:"W",score:3,opponent_score:1}},
    expected_home_school_id:"df-hrdb8f",
    expected_away_school_id:"df-vt4unv",
    expected_home_score:1,
    expected_away_score:3,
    execution:"verify-only-no-write",
    evidence_rule:"The canonical is already correct and must be corroborated by all four exact reciprocal DragonFly observations. No MaxPreps row is required or invented."
  }),
  Object.freeze({
    key:"harrison-cotter-rematch-20260829",
    repair_class:"verified-rematch-split",
    canonical_id:"ce:volleyball:girls:2026:df-ht8yyh:df-sz3b5e:20260829:mp-350185fc-ef8a-471b-a26e-1c9f04dfc231",
    second_canonical_id:"ce:volleyball:girls:2026:df-ht8yyh:df-sz3b5e:20260829:mp-3fa66510-5b2b-47c8-b51a-642679c44b6a",
    authoritative_contest_ids:["350185fc-ef8a-471b-a26e-1c9f04dfc231","3fa66510-5b2b-47c8-b51a-642679c44b6a"],
    authoritative_game_ids:[
      "maxpreps-volleyball-results:df-ht8yyh-volleyball-2026:native:350185fc-ef8a-471b-a26e-1c9f04dfc231",
      "maxpreps-volleyball-results:df-sz3b5e-volleyball-2026:native:350185fc-ef8a-471b-a26e-1c9f04dfc231",
      "maxpreps-volleyball-results:df-ht8yyh-volleyball-2026:native:3fa66510-5b2b-47c8-b51a-642679c44b6a",
      "maxpreps-volleyball-results:df-sz3b5e-volleyball-2026:native:3fa66510-5b2b-47c8-b51a-642679c44b6a"
    ],
    local_team_ids:["df-ht8yyh-volleyball-2026","df-sz3b5e-volleyball-2026"],
    authoritative_truth:{
      "350185fc-ef8a-471b-a26e-1c9f04dfc231":{harrison:2,cotter:0},
      "3fa66510-5b2b-47c8-b51a-642679c44b6a":{harrison:3,cotter:1}
    },
    execution:"verify-existing-split-no-write"
  }),
  Object.freeze({
    key:"cabot-blue-springs-south-rematch-20260829",
    repair_class:"verified-rematch-split",
    canonical_id:"ce:volleyball:girls:2026:df-kq5hlr:mp-xe6tf6lf7uco1soenbisnw-7a263f82:20260829:mp-441a726d-4c94-4d68-bae8-4101f7d54446",
    second_canonical_id:"ce:volleyball:girls:2026:df-kq5hlr:mp-xe6tf6lf7uco1soenbisnw-7a263f82:20260829:mp-df6a4eed-d762-4c70-abe3-624fd7452bcc",
    authoritative_contest_ids:["441a726d-4c94-4d68-bae8-4101f7d54446","df6a4eed-d762-4c70-abe3-624fd7452bcc"],
    authoritative_game_ids:[
      "maxpreps-volleyball-results:df-kq5hlr-volleyball-2026:native:441a726d-4c94-4d68-bae8-4101f7d54446",
      "maxpreps-volleyball-results:df-kq5hlr-volleyball-2026:native:df6a4eed-d762-4c70-abe3-624fd7452bcc"
    ],
    local_team_ids:["df-kq5hlr-volleyball-2026"],
    authoritative_truth:{
      "441a726d-4c94-4d68-bae8-4101f7d54446":{cabot:2,blue_springs_south:0},
      "df6a4eed-d762-4c70-abe3-624fd7452bcc":{cabot:1,blue_springs_south:2}
    },
    execution:"verify-existing-split-no-write"
  })
]);

export const RECORD_TRUTH_REPAIR_TEAM_IDS = Object.freeze([
  ...new Set(RECORD_TRUTH_REPAIR_CASES.flatMap(item=>item.local_team_ids))
]);

export const RECORD_TRUTH_PRODUCTION_REPAIR_PLAN = Object.freeze({
  version:"record-truth-six-games-v2",
  approval_required:true,
  production_write_authorized:false,
  preflight:{
    statements_max:4,
    rows_read_max:300,
    rows_written:0,
    scope:"Six isolated record-truth events only. Read canonical members by canonical_event_members primary-key prefix plus exact deterministic game ids; never scan the games table by source_event_key.",
    fingerprint_required:true,
    fail_closed:true
  },
  execution:[
    "Treat the two Aug. 25 partial-score games as already repaired by the previously approved fingerprinted final-missing-score-v2 production correction.",
    "Repair only North Little Rock/Beebe if the exact two reciprocal MaxPreps native rows still prove Beebe 3-0 North Little Rock and the exact Mascot row is still FINAL T 0-0. Downgrade that placeholder, set the canonical to Beebe 3-0, and resolve only that event's score conflict.",
    "Verify North Little Rock/Lakeside as North Little Rock 1-3 Lakeside from the four exact reciprocal DragonFly rows. This case is verify-only and must not invent or require a MaxPreps observation.",
    "Verify Harrison/Cotter already has two distinct canonicals for the 2-0 and 3-1 Harrison wins.",
    "Verify Cabot/Blue Springs South already has two distinct canonicals for Cabot 2-0 and Cabot 1-2.",
    "Rebuild only teams whose production rows were actually changed; current expected maximum is North Little Rock plus Beebe (2 teams).",
    "Perform one exact-scope post-write verification before the separately approved statewide audit."
  ],
  write_fuses:{
    primary_canonical_repairs_max:1,
    placeholder_game_rows_max:1,
    rematch_member_detaches_max:0,
    rematch_new_canonicals_max:0,
    active_conflict_rows_resolved_max:2,
    local_team_record_rebuilds_max:2,
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
