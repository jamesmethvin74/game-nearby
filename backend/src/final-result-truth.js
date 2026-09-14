function cleanResult(value) {
  const result = String(value ?? "").trim().toUpperCase();
  return /^[WLT]$/.test(result) ? result : null;
}

function finiteScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function scoreKeys(row = {}) {
  const snake = Object.prototype.hasOwnProperty.call(row, "team_score")
    || Object.prototype.hasOwnProperty.call(row, "opponent_score");
  return snake
    ? { team: "team_score", opponent: "opponent_score" }
    : { team: "teamScore", opponent: "opponentScore" };
}

function isVolleyball(row = {}) {
  return String(row.sport || "").trim().toLowerCase() === "volleyball";
}

export function resultFromTeamScores(teamScore, opponentScore) {
  const team = finiteScore(teamScore);
  const opponent = finiteScore(opponentScore);
  if (team == null || opponent == null) return null;
  if (team === opponent) return "T";
  return team > opponent ? "W" : "L";
}

export function evaluateFinalResultTruth(row = {}) {
  const normalized = { ...row };
  const status = String(row.status || "").trim().toUpperCase();
  const explicitResult = cleanResult(row.result);
  const keys = scoreKeys(row);
  const teamScore = finiteScore(row[keys.team]);
  const opponentScore = finiteScore(row[keys.opponent]);

  if (status !== "FINAL") {
    return {
      row: normalized,
      state: "NOT_FINAL",
      reason: null,
      corrected: false,
      explicit_result: explicitResult,
      numeric_result: resultFromTeamScores(teamScore, opponentScore),
      orientation_source: explicitResult ? "explicit-result" : "none"
    };
  }

  if (teamScore == null || opponentScore == null) {
    return {
      row: normalized,
      state: "UNRESOLVED",
      reason: "FINAL_MISSING_SCORES",
      corrected: false,
      explicit_result: explicitResult,
      numeric_result: null,
      orientation_source: explicitResult ? "explicit-result" : "none"
    };
  }

  const numericResult = resultFromTeamScores(teamScore, opponentScore);

  // Volleyball has no tied match result. Older Mascot rows used T 0-0 as an
  // unknown-result placeholder, and some of those rows predate the parser fix.
  // Treat a tied volleyball score as unresolved, and ignore a stale explicit T
  // when independently oriented numeric/canonical scores prove a W or L.
  if (isVolleyball(row) && explicitResult === "T") {
    if (numericResult === "T") {
      normalized.result = null;
      return {
        row: normalized,
        state: "UNRESOLVED",
        reason: "VOLLEYBALL_TIE_PLACEHOLDER",
        corrected: false,
        explicit_result: explicitResult,
        numeric_result: numericResult,
        orientation_source: "invalid-volleyball-tie-placeholder"
      };
    }
    normalized.result = numericResult;
    return {
      row: normalized,
      state: "VERIFIED",
      reason: "VOLLEYBALL_TIE_PLACEHOLDER_IGNORED",
      corrected: false,
      explicit_result: explicitResult,
      numeric_result: numericResult,
      orientation_source: "team-oriented-score"
    };
  }

  if (!explicitResult) {
    normalized.result = numericResult;
    return {
      row: normalized,
      state: "VERIFIED",
      reason: null,
      corrected: false,
      explicit_result: null,
      numeric_result: numericResult,
      orientation_source: "team-oriented-score"
    };
  }

  if (explicitResult === "T") {
    if (numericResult !== "T") {
      return {
        row: normalized,
        state: "CONTRADICTORY",
        reason: "EXPLICIT_TIE_SCORE_CONTRADICTION",
        corrected: false,
        explicit_result: explicitResult,
        numeric_result: numericResult,
        orientation_source: "explicit-result"
      };
    }
    normalized.result = "T";
    return {
      row: normalized,
      state: "VERIFIED",
      reason: null,
      corrected: false,
      explicit_result: explicitResult,
      numeric_result: numericResult,
      orientation_source: "explicit-result"
    };
  }

  if (numericResult === explicitResult) {
    normalized.result = explicitResult;
    return {
      row: normalized,
      state: "VERIFIED",
      reason: null,
      corrected: false,
      explicit_result: explicitResult,
      numeric_result: numericResult,
      orientation_source: "explicit-result"
    };
  }

  if (numericResult === "T") {
    return {
      row: normalized,
      state: "CONTRADICTORY",
      reason: "EXPLICIT_RESULT_TIED_SCORE_CONTRADICTION",
      corrected: false,
      explicit_result: explicitResult,
      numeric_result: numericResult,
      orientation_source: "explicit-result"
    };
  }

  normalized[keys.team] = opponentScore;
  normalized[keys.opponent] = teamScore;
  normalized.result = explicitResult;
  return {
    row: normalized,
    state: "VERIFIED",
    reason: "EXPLICIT_RESULT_ORIENTATION_CORRECTED",
    corrected: true,
    explicit_result: explicitResult,
    numeric_result: resultFromTeamScores(opponentScore, teamScore),
    orientation_source: "explicit-result"
  };
}

export function normalizeFinalResultTruth(row = {}) {
  return evaluateFinalResultTruth(row).row;
}

export function sanitizeFinalForCanonical(row = {}) {
  const evaluated = evaluateFinalResultTruth(row);
  if (evaluated.state === "VERIFIED" || evaluated.state === "NOT_FINAL") return evaluated.row;
  const keys = scoreKeys(evaluated.row);
  return {
    ...evaluated.row,
    [keys.team]: null,
    [keys.opponent]: null
  };
}

export function resultTruthIssue(row = {}) {
  const evaluated = evaluateFinalResultTruth(row);
  if (evaluated.state === "VERIFIED" || evaluated.state === "NOT_FINAL") return null;
  return {
    state: evaluated.state,
    code: evaluated.reason,
    explicit_result: evaluated.explicit_result,
    numeric_result: evaluated.numeric_result
  };
}
