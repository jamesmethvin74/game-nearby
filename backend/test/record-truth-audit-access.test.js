import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/m8-worker.js", import.meta.url), "utf8");

test("statewide record-truth audit is manual, token-protected, and non-cacheable", () => {
  assert.match(source, /function authorizedAudit\(request,env\)/);
  assert.match(source, /Boolean\(env\.REFRESH_TOKEN\)/);
  assert.match(source, /request\.headers\.get\("x-refresh-token"\) === env\.REFRESH_TOKEN/);
  assert.match(source, /if \(!authorizedAudit\(request,env\)\) return auditJson\(\{error:"not_found"\},404\)/);
  assert.match(source, /"cache-control":"no-store"/);
  assert.doesNotMatch(source, /"access-control-allow-origin":"\*"/);
});
