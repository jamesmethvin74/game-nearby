import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { VOLLEYBALL_CONVERGENCE_READY_PATH,authorizedVolleyballConvergence,volleyballConvergenceReadiness } from "../src/logo-bootstrap-worker.js";
import { VOLLEYBALL_CONVERGENCE_PATH } from "../src/volleyball-convergence-batch.js";

test("v3 convergence endpoint requires its dedicated token",()=>{
  assert.equal(VOLLEYBALL_CONVERGENCE_PATH,"/api/v1/internal/volleyball-convergence");
  assert.equal(VOLLEYBALL_CONVERGENCE_READY_PATH,"/api/v1/internal/volleyball-convergence/ready");
  const env={VOLLEYBALL_CONVERGENCE_TOKEN:"secret"};
  const good=new Request("https://example.test/api/v1/internal/volleyball-convergence/ready",{method:"HEAD",headers:{"x-volleyball-convergence-token":"secret"}});
  const bad=new Request("https://example.test/api/v1/internal/volleyball-convergence/ready",{method:"HEAD"});
  assert.equal(authorizedVolleyballConvergence(good,env),true);
  assert.equal(volleyballConvergenceReadiness(good,env).status,204);
  assert.equal(volleyballConvergenceReadiness(bad,env).status,404);
});

test("executor only makes bounded readiness, post, and verification calls",()=>{
  const s=fs.readFileSync(new URL("../scripts/run-approved-aug24-volleyball-convergence-v3.sh",import.meta.url),"utf8");
  assert.doesNotMatch(s,/wrangler deploy|workers\/scripts\/.+\/secrets|wrangler d1 execute|migrations apply|db:migrate:remote/i);
  assert.match(s,/wrangler\.jsonc/);
  assert.match(s,/VOLLEYBALL_CONVERGENCE_TOKEN/);
  assert.match(s,/x-volleyball-convergence-token/);
  assert.match(s,/aug24-external-opponents-v1/);
  assert.match(s,/api\/v1\/scores/);
});
