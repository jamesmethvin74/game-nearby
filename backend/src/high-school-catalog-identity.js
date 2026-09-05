import decisions from "../data/high-school-catalog-identity-decisions.json" with { type: "json" };

const reviewedKeepById = new Map(decisions.keep.map(row => [row.school_id, row]));
const reviewedExcludeById = new Map(decisions.exclude.map(row => [row.school_id, row]));

export const REVIEWED_HIGH_SCHOOL_KEEP_IDS = Object.freeze([...reviewedKeepById.keys()]);
export const REVIEWED_HIGH_SCHOOL_EXCLUDE_IDS = Object.freeze([...reviewedExcludeById.keys()]);
export const REVIEWED_HIGH_SCHOOL_USER_FACING_DENOMINATOR = Number(decisions.user_facing_high_school_denominator);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function highSchoolCatalogIdentityDecision(school = {}) {
  const id = clean(school.id || school.school_id);
  const name = clean(school.name || school.school_name);
  const level = clean(school.level).toLowerCase();

  if (level && level !== "high-school") return { decision: "not-applicable", reason: "non-high-school-level" };

  const keep = reviewedKeepById.get(id);
  if (keep) return { decision: "keep", reason: keep.reason, reviewed: true, row: keep };

  const exclude = reviewedExcludeById.get(id);
  if (exclude) return { decision: "exclude", reason: exclude.reason, reviewed: true, row: exclude };

  const normalizedName = name.toLowerCase();
  if (/\belementary\b/.test(normalizedName)) {
    return { decision: "exclude", reason: "elementary-name-rule", reviewed: false };
  }
  if (/\bjunior high\b/.test(normalizedName)) {
    return { decision: "exclude", reason: "junior-high-name-rule", reviewed: false };
  }

  return { decision: "unreviewed", reason: null, reviewed: false };
}

export function isSchoolCatalogVisible(school = {}) {
  return highSchoolCatalogIdentityDecision(school).decision !== "exclude";
}

export function reviewedHighSchoolIdentitySummary() {
  return {
    version: decisions.version,
    reviewedAt: decisions.reviewed_at,
    baseCertifiedHighSchools: Number(decisions.base_certified_high_school_count),
    reviewedKeepAdditions: reviewedKeepById.size,
    reviewedExclusions: reviewedExcludeById.size,
    userFacingHighSchoolDenominator: REVIEWED_HIGH_SCHOOL_USER_FACING_DENOMINATOR
  };
}
