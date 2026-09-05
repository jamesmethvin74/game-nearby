import test from "node:test";
import assert from "node:assert/strict";
import { FINAL_49_SCHOOL_BRANDING_IDENTITIES } from "../src/school-branding-final49.js";

const expectedIds = [
  "aaa-c36asb","aaa-6km4qu","aaa-9dwqeg","aaa-nwwk4z","aaa-ak6fwg","aaa-3qbpwe","aaa-h95ncz","aaa-pn87ny","aaa-79skph","aaa-ygav2l",
  "aaa-lmvkjs","aaa-pv6quz","aaa-zbqf4u","aaa-6levpu","aaa-7qee96","aaa-rp6yzq","aaa-jkhdak","aaa-kkngn2","aaa-jp55l3","aaa-zgpvlc",
  "aaa-cjyqlc","aaa-6nhfsm","aaa-rsclm3","aaa-txnuhv","aaa-c2ee5g","aaa-y7mrh7","aaa-agkhey","aaa-psz7kc","aaa-m85aw5","aaa-fyz9e7",
  "aaa-tjdvar","aaa-9rqzs6","aaa-u72rhs","aaa-ctkl54","aaa-kzmc87","aaa-3dakjs","aaa-ncmjwz","aaa-nsekyc","aaa-vrtb7w","aaa-ptzw9n",
  "aaa-9mwyaa","aaa-nylqrf","aaa-gbew3s","aaa-jbwefe","aaa-n7tzk3","aaa-sl6prj","aaa-baz2qb","aaa-ap5pk9","aaa-tj94gm"
];

test("final logo curation pins the exact remaining 49 AAA schools", () => {
  assert.equal(expectedIds.length, 49);
  assert.equal(new Set(expectedIds).size, 49);
  assert.equal(FINAL_49_SCHOOL_BRANDING_IDENTITIES.length, 49);
  const byId = new Map(FINAL_49_SCHOOL_BRANDING_IDENTITIES.map(row => [row.targetSchoolId, row]));
  assert.equal(byId.size, 49);
  for (const id of expectedIds) {
    const row = byId.get(id);
    assert.ok(row, `missing curated logo row for ${id}`);
    assert.match(row.logoUrl, /^https:\/\//, `${id} must have a stable https logo/image asset`);
    assert.match(row.sourceUrl, /^https:\/\//, `${id} must have a source URL`);
    assert.ok(Array.isArray(row.targetNames) && row.targetNames.length > 0, `${id} must retain a reviewed name`);
  }
});
