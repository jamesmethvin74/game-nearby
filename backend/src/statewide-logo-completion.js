import { syncMaxPrepsSchoolBranding, enrichMaxPrepsSchoolMascots } from "./school-branding.js";
import { syncCuratedSchoolBranding } from "./school-branding-curated-sync.js";

export const MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS = "https://www.maxpreps.com/ar/basketball/schools/";
export const MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS = "https://www.maxpreps.com/ar/volleyball/schools/";

export async function runStatewideHighSchoolLogoCompletion(env, {
  now = new Date(),
  force = true,
  mascotLimit = 20
} = {}) {
  const basketball = await syncMaxPrepsSchoolBranding(env, {
    sourceUrl: MAXPREPS_ARKANSAS_BASKETBALL_SCHOOLS,
    now,
    force
  });
  const volleyball = await syncMaxPrepsSchoolBranding(env, {
    sourceUrl: MAXPREPS_ARKANSAS_VOLLEYBALL_SCHOOLS,
    now,
    force
  });
  const curated = await syncCuratedSchoolBranding(env, { now, force });
  const mascots = await enrichMaxPrepsSchoolMascots(env, { now, limit: mascotLimit });

  return {
    status: [basketball, volleyball, curated].some(result => result?.status === "PARTIAL") ? "PARTIAL" : "SUCCESS",
    basketball,
    volleyball,
    curated,
    mascots
  };
}
