const BASE="https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026";

function config({key,feedCode,providerSportCode,sport,gender,teamCode,expectedTargets,minEvents}) {
  return Object.freeze({
    key,
    feedCode,
    providerSportCode,
    sport,
    gender,
    teamCode,
    season:"2026",
    expectedTargets,
    minEvents,
    feedUrl:`${BASE}/${feedCode}/0`,
    stateId:`dragonfly:ArkAA:2026:${feedCode}`,
    catalogSyncId:`dragonfly-catalog:ArkAA:2026:${feedCode}`
  });
}

export const STATEWIDE_HIGH_SCHOOL_SPORTS=Object.freeze([
  config({key:"football-boys",feedCode:"MFB_Varsity",providerSportCode:"MFB",sport:"football",gender:"boys",teamCode:"FB",expectedTargets:194,minEvents:300}),
  config({key:"basketball-boys",feedCode:"MBB_Varsity",providerSportCode:"MBB",sport:"basketball",gender:"boys",teamCode:"MBB",expectedTargets:286,minEvents:500}),
  config({key:"basketball-girls",feedCode:"WBB_Varsity",providerSportCode:"WBB",sport:"basketball",gender:"girls",teamCode:"WBB",expectedTargets:281,minEvents:500}),
  config({key:"soccer-boys",feedCode:"MSO_Varsity",providerSportCode:"MSO",sport:"soccer",gender:"boys",teamCode:"MSO",expectedTargets:79,minEvents:75}),
  config({key:"soccer-girls",feedCode:"WSO_Varsity",providerSportCode:"WSO",sport:"soccer",gender:"girls",teamCode:"WSO",expectedTargets:77,minEvents:60}),
  config({key:"volleyball-girls",feedCode:"WVB_Varsity",providerSportCode:"WVB",sport:"volleyball",gender:"girls",teamCode:"WVB",expectedTargets:185,minEvents:500})
]);

export const STATEWIDE_SPORT_BY_KEY=new Map(STATEWIDE_HIGH_SCHOOL_SPORTS.map(item=>[item.key,item]));
export const STATEWIDE_SPORT_BY_TEAM_CODE=new Map(STATEWIDE_HIGH_SCHOOL_SPORTS.map(item=>[item.teamCode,item]));

export function statewideSportConfig(value) {
  if (value && typeof value==="object" && value.feedCode && value.sport && value.gender) return value;
  const key=String(value||"").trim();
  const found=STATEWIDE_SPORT_BY_KEY.get(key) || STATEWIDE_SPORT_BY_TEAM_CODE.get(key.toUpperCase());
  if (!found) throw new Error(`Unknown statewide sport config: ${key||"(empty)"}`);
  return found;
}
