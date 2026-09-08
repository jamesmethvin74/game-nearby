import test from "node:test";
import assert from "node:assert/strict";
import { AUG24_AUDIT_RUN_ID,AUG24_FINALS,AUG24_FINALIZE_PATH,AUG24_FINALIZE_STATUS_PATH } from "../src/volleyball-aug24-finalizer.js";

test("Aug 24 finalizer is locked to the three audited finals",()=>{
  assert.equal(AUG24_AUDIT_RUN_ID,34172135818);
  assert.equal(AUG24_FINALIZE_PATH,"/api/v1/internal/volleyball-aug24-finalize");
  assert.equal(AUG24_FINALIZE_STATUS_PATH,"/api/v1/internal/volleyball-aug24-finalize/status");
  assert.deepEqual(AUG24_FINALS.map(row=>[row.contestId,row.teamId,row.localScore,row.opponentScore]),[
    ["bf452b95-43e9-412c-8bbc-80fcd92ca147","df-ezw3f9-volleyball-2026",3,1],
    ["01c9d8e3-fdea-4c12-879b-6a9f9726bb58","df-26g9fq-volleyball-2026",3,1],
    ["b3ba2de8-200c-412e-923e-7bad05699fd2","df-kybtet-volleyball-2026",1,3]
  ]);
});
