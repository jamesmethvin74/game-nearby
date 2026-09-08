import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VOLLEYBALL_CONVERGENCE_READY_PATH,
  authorizedVolleyballConvergence,
  volleyballConvergenceReadiness
} from "../src/logo-bootstrap-worker.js";
import { VOLLEYBALL_CONVERGENCE_PATH } from "../src/volleyball-convergence-batch.js";

test("bounded volleyball convergence uses its own private token and readiness path",()=>{
  assert.equal(VOLLEYBALL_CONVERGENCE_PATH,"/api/v1/internal/volleyball-convergence");
  assert.equal(VOLLEYBALL_CONVERGENCE_READY_PATH,"/api/v1/internal/volleyball-convergence/ready");
  const env={VOLLEYBALL_CONVERGENCE_TOKEN:"secret",LOGO_BOOTSTRAP_TOKEN:"logo",REFRESH_TOKEN:"refresh"};
  const good=new Request("https://example.test/api/v1/internal/volleyball-convergence/ready",{method:"HEAD",headers:{"x-volleyball-convergence-token":"secret"}});
  const logo=new Request("https://example.test/api/v1/internal/volleyball-convergence/ready",{method:"HEAD",headers:{"x-logo-bootstrap-token":"logo"}});
  const refresh=new Request("https://example.test/api/v1/internal/volleyball-convergence/ready",{method:"HEAD",headers:{"x-refresh-token":"refresh"}});
  assert.equal(authorizedVolleyballConvergence(good,env),true);
  assert.equal(authorizedVolleyballConvergence(logo,env),false);
  assert.equal(authorizedVolleyballConvergence(refresh,env),false);
  assert.equal(volleyballConvergenceReadiness(good,env).status,204);
  assert.equal(volleyballConvergenceReadiness(logo,env).status,404);
});

test("v2 executor is inert until explicitly wired into deploy and contains no direct D1 shell work",()=>{
  const source=fs.readFileSync(new URL("../scripts/run-approved-aug24-volleyball-convergence-v2.sh",import.meta.url),"utf8");
  assert.match(source,/VOLLEYBALL_CONVERGENCE_TOKEN/);
  assert.match(source,/x-volleyball-convergence-token/);
  assert.match(source,/aug24-external-opponents-v1/);
  assert.doesNotMatch(source,/wrangler d1 execute|migrations apply|db:migrate:remote/i);
});
