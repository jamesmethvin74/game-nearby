import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VOLLEYBALL_CONVERGENCE_PATH,
  VOLLEYBALL_CONVERGENCE_READY_PATH,
  authorizedVolleyballConvergence,
  volleyballConvergenceReadiness
} from "../src/logo-bootstrap-worker.js";

test("one-shot volleyball convergence surface is token protected and private",()=>{
  assert.equal(VOLLEYBALL_CONVERGENCE_PATH,"/api/v1/internal/volleyball-convergence");
  assert.equal(VOLLEYBALL_CONVERGENCE_READY_PATH,"/api/v1/internal/volleyball-convergence/ready");
  const env={VOLLEYBALL_CONVERGENCE_TOKEN:"secret"};
  const good=new Request("https://example.test/api/v1/internal/volleyball-convergence/ready",{method:"HEAD",headers:{"x-volleyball-convergence-token":"secret"}});
  const bad=new Request("https://example.test/api/v1/internal/volleyball-convergence/ready",{method:"HEAD",headers:{"x-volleyball-convergence-token":"wrong"}});
  assert.equal(authorizedVolleyballConvergence(good,env),true);
  assert.equal(authorizedVolleyballConvergence(bad,env),false);
  assert.equal(volleyballConvergenceReadiness(good,env).status,204);
  assert.equal(volleyballConvergenceReadiness(bad,env).status,404);
});

test("Cloudflare one-shot executor stays bounded and avoids direct production D1 shell work",()=>{
  const source=fs.readFileSync(new URL("../scripts/run-approved-volleyball-convergence.sh",import.meta.url),"utf8");
  assert.match(source,/CLOUDFLARE_API_TOKEN/);
  assert.match(source,/VOLLEYBALL_CONVERGENCE_TOKEN/);
  assert.match(source,/x-volleyball-convergence-token/);
  assert.equal((source.match(/RUN_PATH/g)||[]).length>=2,true);
  assert.doesNotMatch(source,/wrangler d1 execute|migrations apply|db:migrate:remote/i);
  assert.match(source,/STATEWIDE_VOLLEYBALL_CONVERGENCE_VERIFIED/);
  for(const id of ["conway-volleyball-2026","df-bkc4ux-volleyball-2026","df-qyu4f7-volleyball-2026","df-x7qmns-volleyball-2026"]){
    assert.match(source,new RegExp(id));
  }
});
