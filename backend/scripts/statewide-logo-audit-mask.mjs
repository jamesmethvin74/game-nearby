export const AUDIT_MISSING_IDS = [
  "arkansas-baptist","arkansas-state","asu-mid-south","asu-three-rivers","asu-mountain-home","asu-newport","arkansas-tech","cbc","champion-christian","crowleys-ridge","ecclesia","harding","henderson-state","hendrix","john-brown","lyon","national-park","north-arkansas","nwacc","ouachita-baptist","philander-smith","shorter","south-arkansas","seark","southern-arkansas","sau-tech","uark","ua-cossatot","ua-rich-mountain","uafs","little-rock","uam","uapb","uca","ozarks","williams-baptist","aaa-c36asb","aaa-6km4qu","aaa-9dwqeg","aaa-nwwk4z","aaa-ak6fwg","aaa-pauj7m","aaa-f5bmwj","aaa-v6mdnm","aaa-3qbpwe","aaa-ez9x2w","aaa-be6ele","aaa-v775t6","aaa-ve2k8d","aaa-h95ncz","aaa-pn87ny","aaa-sljghx","aaa-6uby3p","aaa-79skph","aaa-xrl8nl","aaa-ygav2l","aaa-9539dm","aaa-bncur7","aaa-3rv89e","aaa-5f3yhb","aaa-g6qwxw","aaa-6xa4la","aaa-lmvkjs","aaa-pv6quz","aaa-4974gd","aaa-bvl6x2","aaa-p6dp36","aaa-xfxsgq","aaa-ctkgcw","aaa-zbqf4u","aaa-fhffm4","aaa-ullt9d","aaa-6levpu","aaa-7qee96","aaa-s6ba6t","aaa-czwxqp","aaa-rp6yzq","aaa-eha64g","aaa-8muwmy","aaa-2qzd2q","aaa-jkhdak","aaa-zmhvly","aaa-kkngn2","aaa-jp55l3","aaa-aslqvp","aaa-x396ks","aaa-bappnv","aaa-zgpvlc","aaa-cjyqlc","aaa-4ppke4","aaa-6nhfsm","aaa-e426qu","aaa-xj4qtb","aaa-2cqyeh","aaa-rsclm3","aaa-d3qcqw","aaa-txnuhv","aaa-qtg924","aaa-c2ee5g","aaa-wqpldr","aaa-zemdyn","aaa-y7mrh7","aaa-agkhey","aaa-psz7kc","aaa-ut4wxy","aaa-m85aw5","aaa-cvtnh9","aaa-fyz9e7","aaa-4q6jwq","aaa-ferexu","aaa-abvjv7","aaa-5e794s","aaa-g5n2r9","aaa-lwdshk","aaa-tjdvar","aaa-9rqzs6","aaa-zhc63n","aaa-u72rhs","aaa-ctkl54","aaa-kzmc87","aaa-3dakjs","aaa-k5kpg3","aaa-rwg2ef","aaa-lvnrne","aaa-h9rjmj","aaa-u4phhm","aaa-w4ft74","aaa-ncmjwz","aaa-nsekyc","aaa-vrtb7w","aaa-bufsnz","aaa-ptzw9n","aaa-gzbrup","aaa-9mwyaa","aaa-nylqrf","aaa-gbew3s","aaa-jbwefe","aaa-n7tzk3","aaa-k4khl3","aaa-sl6prj","aaa-54y79f","aaa-baz2qb","aaa-ap5pk9","aaa-crufas","aaa-u96m34","aaa-tj94gm","aaa-7hmz7c"
];

function toBase32(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export function encodeMissingMask(missingSegment) {
  const bytes = Buffer.alloc(Math.ceil(AUDIT_MISSING_IDS.length / 8));
  let count = 0;
  for (let index = 0; index < AUDIT_MISSING_IDS.length; index++) {
    if (!missingSegment.includes(AUDIT_MISSING_IDS[index])) continue;
    bytes[Math.floor(index / 8)] |= 1 << (index % 8);
    count++;
  }
  return { count, encoded: toBase32(bytes) };
}
