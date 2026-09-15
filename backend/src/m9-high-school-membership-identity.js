function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function safe(value){return clean(value).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}

export function normalizeMembershipSourceSchoolName(value){
  return clean(value)
    .replace(/&#(?:39|x27);/gi,"'")
    .replace(/^([A-Za-z])\s+(?=\1[A-Za-z])/i,"")
    .trim();
}

export const HIGH_SCHOOL_IDENTITY_OVERRIDES=new Map([
  ["*|*|arkansas","aaa-nwwk4z"],["*|*|advanced-studies","aaa-9mwyaa"],["*|*|deer","aaa-lmvkjs"],["*|*|mount-judea","aaa-fyz9e7"],["*|*|norfork","df-pucby7"],["*|*|crowleys-ridge-academy","df-clv7np"],["*|*|mulberry","df-wsadek"],["*|*|oark","aaa-tjdvar"],["*|*|western-yell-county","aaa-baz2qb"],["*|*|bradford","aaa-3qbpwe"],["*|*|sacred-heart","aaa-nsekyc"],["*|*|arkansas-school-for-the-deaf","aaa-6km4qu"],["*|*|exalt-academy","df-a6slv2"],["*|*|friendship-aspire-academy","df-6blldr"],["*|*|oden","aaa-9rqzs6"],["*|*|umpire","aaa-sl6prj"],["*|*|izard-county","df-354bu3"],["*|*|ozark-mountain","aaa-kzmc87"],["*|*|white-county-central","aaa-ap5pk9"],["*|*|east-poinsett-county","aaa-6levpu"],["*|*|mt-vernon-enola","aaa-m85aw5"],["*|*|st-joseph","df-snevs7"],["*|*|palestine-wheatley","df-gjusdz"],["*|*|providence-academy","df-k7ketx"],["*|*|subiaco-academy","aaa-jbwefe"],["*|*|baptist-prep","df-vc87t4"],["*|*|glen-rose","aaa-jkhdak"],["*|*|episcopal","df-8j9f3x"],["*|*|morrilton","df-wlwrfa"],["*|*|de-queen","aaa-pv6quz"],["*|*|catholic","aaa-ygav2l"],["*|*|parkview","df-jbclsd"],["*|*|robinson","df-dss449"],["*|*|abundant-life","df-qrvx97"],["*|*|garrett-memorial-christian","df-k22r2h"],["*|*|founders-classical-academy","df-vs7zsu"],["*|*|hot-springs","df-c7mr94"],["*|*|hall","aaa-jp55l3"],["*|*|fayetteville-christian","aaa-7qee96"],["*|*|lee","df-tnebcj"],["*|*|union-christian","df-ktr7yd"],["*|*|union-christian-academy","df-ktr7yd"],["*|*|nemo-vista","df-28tzpd"],["*|*|west-fork","df-qlkhe2"],["*|*|lonoke","df-qyakr5"],["*|*|forrest-city","aaa-rp6yzq"],
  ["basketball-boys|1a-region-6|marvell","aaa-agkhey"],["basketball-girls|1a-region-6|marvell","aaa-agkhey"],["basketball-boys|1a-region-8|huttig","aaa-gbew3s"],["basketball-girls|1a-region-8|huttig","aaa-gbew3s"],["football-boys|8-man--south-8-man-|strong","aaa-gbew3s"],
  ["basketball-boys|3a-region-1|haas-hall-academy","aaa-6nhfsm"],["basketball-girls|3a-region-1|haas-hall-academy","aaa-6nhfsm"],["soccer-boys|3a-west|haas-hall-academy","aaa-6nhfsm"],["soccer-girls|3a-west|haas-hall-academy","aaa-6nhfsm"],
  ["basketball-boys|3a-region-6|central","df-7kza8c"],["basketball-girls|3a-region-6|central","df-7kza8c"],["basketball-boys|6a-central|central","df-t2mq54"],["basketball-girls|6a-central|central","df-t2mq54"],["football-boys|3a-region-8|central","df-7kza8c"],["football-boys|7a-central|central","df-t2mq54"],["volleyball-girls|3a-3|central","df-7kza8c"],["volleyball-girls|6a-central|central","df-t2mq54"],["soccer-boys|6a-central|central","df-t2mq54"],["soccer-girls|6a-central|central","df-t2mq54"],["soccer-boys|6a-central|little-rock-central","df-t2mq54"],["soccer-girls|6a-central|little-rock-central","df-t2mq54"],
  ["basketball-boys|3a-region-8|harmony-grove","df-3wa5q2"],["basketball-girls|3a-region-8|harmony-grove","df-3wa5q2"],["basketball-boys|4a-region-4|harmony-grove","df-yj7aj5"],["basketball-girls|4a-region-4|harmony-grove","df-yj7aj5"],["football-boys|3a-region-7|harmony-grove","df-3wa5q2"],["football-boys|4a-region-2|harmony-grove","df-yj7aj5"],["volleyball-girls|3a-6|harmony-grove","df-3wa5q2"],["volleyball-girls|4a-6|harmony-grove","df-yj7aj5"],
  ["basketball-boys|3a-region-8|lakeside","aaa-txnuhv"],["basketball-girls|3a-region-8|lakeside","aaa-txnuhv"],["basketball-boys|5a-south|lakeside","df-vt4unv"],["basketball-girls|5a-south|lakeside","df-vt4unv"],["football-boys|3a-region-8|lakeside","aaa-txnuhv"],["football-boys|5a-south|lakeside","df-vt4unv"],["volleyball-girls|5a-south|lakeside","df-vt4unv"],["soccer-boys|3a-east|lakeside","aaa-txnuhv"],["soccer-girls|3a-east|lakeside","aaa-txnuhv"],["soccer-boys|5a-south|lakeside","df-vt4unv"],["soccer-girls|5a-south|lakeside","df-vt4unv"],
  ["volleyball-girls|4a-5|lisa-academy","df-epraq7"],["soccer-boys|4a-north|lisa-academy","df-epraq7"],
  ["football-boys|4a-region-3|southside","df-s3xu7u"],["football-boys|6a-west|southside","df-jh2s9b"],["volleyball-girls|4a-4|southside","df-s3xu7u"],["volleyball-girls|6a-west|southside","df-jh2s9b"],["basketball-boys|4a-region-2|southside","df-s3xu7u"],["basketball-boys|6a-west|southside","df-jh2s9b"],["basketball-girls|4a-region-2|southside","df-s3xu7u"],["basketball-girls|6a-west|southside","df-jh2s9b"],["soccer-boys|4a-north|southside","df-s3xu7u"],["soccer-boys|6a-west|southside","df-jh2s9b"],["soccer-girls|4a-north|southside","df-s3xu7u"],["soccer-girls|6a-west|southside","df-jh2s9b"]
]);

export function highSchoolMembershipIdentityOverride(source,conference,observedName){
  const observed=safe(normalizeMembershipSourceSchoolName(observedName));
  return HIGH_SCHOOL_IDENTITY_OVERRIDES.get(`${source.key}|${conference.id}|${observed}`)||HIGH_SCHOOL_IDENTITY_OVERRIDES.get(`*|*|${observed}`)||null;
}

const KNOWN_SOURCE_GAPS=new Set(["basketball-boys|4a-region-6"]);
export function isKnownMembershipSourceGap(sourceKey,conferenceId){return KNOWN_SOURCE_GAPS.has(`${clean(sourceKey).toLowerCase()}|${clean(conferenceId).toLowerCase()}`);}
export { KNOWN_SOURCE_GAPS };
