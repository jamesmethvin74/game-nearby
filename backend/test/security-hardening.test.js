import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import m8Worker, {
  PROTECTED_OPERATIONAL_PATHS,
  applyApiSecurityHeaders,
  sanitizePublicErrorBody,
  sanitizePublicErrorResponse
} from "../src/m8-final-audit-worker.js";
import {
  NEARBY_MAX_RADIUS_MILES,
  NEARBY_MAX_ROWS,
  parseNearbyQuery
} from "../src/one-truth-worker.js";
import { getSchoolBrandingReport } from "../src/school-branding.js";
import coreWorker from "../src/index.js";
import logoWorker, { HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH } from "../src/logo-bootstrap-worker.js";
import m4Worker from "../src/m4-public-worker.js";
import d1UsageWorker from "../src/d1-usage-public-worker.js";

const root = path => new URL(`../../${path}`, import.meta.url);

test("public operational endpoints require server-side authorization before app/D1 work", async () => {
  const env = {
    DB: new Proxy({}, { get() { throw new Error("D1 must not be reached for unauthorized operational reads"); } })
  };
  for (const path of PROTECTED_OPERATIONAL_PATHS) {
    const response = await m8Worker.fetch(new Request(`https://local.test${path}`), env, {});
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("access-control-allow-origin"), null, path);
  }
});

test("public 5xx sanitization removes internal exception detail even when debug headers are forged", async () => {
  const dirty = {
    error: "failed",
    message: "SQLITE_CONSTRAINT secret internals",
    detail: "SELECT private_table",
    diagnostic: "stack trace",
    nested: { cause: "driver internals", safe: "ok" }
  };
  assert.deepEqual(sanitizePublicErrorBody(dirty), {
    error: "failed",
    nested: { safe: "ok" }
  });

  for (const header of ["x-localbleachers-debug", "x-localbleachers-diagnostic"]) {
    const response = await sanitizePublicErrorResponse(
      new Request("https://local.test/api/v1/games", { headers: { [header]: "forged" } }),
      new Response(JSON.stringify(dirty), { status: 503, headers: { "content-type":"application/json" } })
    );
    const body = await response.json();
    assert.equal(body.error, "failed");
    assert.equal("message" in body, false);
    assert.equal("detail" in body, false);
    assert.equal("diagnostic" in body, false);
  }
});

test("API security headers are explicit", () => {
  const response = applyApiSecurityHeaders(new Response("{}"));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("permissions-policy") || "", /geolocation=\(\)/);
  assert.match(response.headers.get("strict-transport-security") || "", /max-age=31536000/);
});

test("nearby query rejects missing/extreme inputs before D1 work", () => {
  assert.equal(parseNearbyQuery(new URL("https://local.test/api/v1/games")).error, "location_required");
  assert.equal(parseNearbyQuery(new URL("https://local.test/api/v1/games?lat=91&lon=-92")).error, "invalid_location");
  assert.equal(
    parseNearbyQuery(new URL(`https://local.test/api/v1/games?lat=35.09&lon=-92.44&radius=${NEARBY_MAX_RADIUS_MILES + 1}`)).error,
    "invalid_radius"
  );
  const since = "2026-01-01T00:00:00.000Z";
  const until = "2026-06-01T00:00:00.000Z";
  assert.equal(
    parseNearbyQuery(new URL(`https://local.test/api/v1/games?lat=35.09&lon=-92.44&radius=25&since=${since}&until=${until}`)).error,
    "date_range_too_large"
  );
});

test("normal UI nearby window remains valid and location is minimized to three decimals", () => {
  const now = Date.parse("2026-09-29T22:00:00.000Z");
  const since = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const until = new Date(now + 120 * 24 * 60 * 60 * 1000).toISOString();
  const query = parseNearbyQuery(new URL(
    `https://local.test/api/v1/games?lat=35.088765&lon=-92.442101&radius=100&since=${since}&until=${until}`
  ), now);
  assert.equal(query.error, undefined);
  assert.equal(query.lat, 35.089);
  assert.equal(query.lon, -92.442);
  assert.equal(query.radius, 100);
  assert.equal(NEARBY_MAX_ROWS, 5000);
});

test("branding report executes reads only", async () => {
  let writes = 0;
  const DB = {
    prepare(sql) {
      const statement = {
        bind() { return statement; },
        async first() {
          if (String(sql).includes("school_brand_sync_state")) return null;
          return {};
        },
        async all() { return { results: [] }; },
        async run() { writes += 1; return { success:true }; }
      };
      return statement;
    }
  };
  const report = await getSchoolBrandingReport({ DB });
  assert.equal(writes, 0);
  assert.equal(report.summary.targetSchools, 0);
});

test("scheduled catalog maintenance still owns branding synchronization and mascot enrichment", async () => {
  const scheduled = await readFile(new URL("../src/milestone2-scheduled-worker.js", import.meta.url), "utf8");
  const cadence = await readFile(new URL("../src/collection-cadence.js", import.meta.url), "utf8");
  assert.match(scheduled, /syncMaxPrepsSchoolBranding/);
  assert.match(scheduled, /enrichMaxPrepsSchoolMascots/);
  assert.match(scheduled, /if\s*\(plan\.runCatalogMaintenance\)/);
  assert.match(cadence, /weekly-catalog-maintenance/);
  assert.match(cadence, /runCatalogMaintenance:\s*true/);
});

test("browser sanitizer escapes upstream HTML and blocks unsafe dynamic URL schemes", async () => {
  const source = await readFile(root("security-utils.js"), "utf8");
  const context = { window:{ location:{ href:"https://local.test/" } }, URL };
  vm.runInNewContext(source, context);
  const security = context.window.LocalBleachersSecurity;
  const escaped = security.escapeHtml('<img src=x onerror="alert(1)">');
  assert.equal(escaped, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(security.safeHttpUrl("javascript:alert(1)", ""), "");
  assert.equal(security.safeHttpUrl("data:text/html,<script>alert(1)</script>", ""), "");
  assert.equal(security.safeHttpUrl("https://example.com/path", ""), "https://example.com/path");
});

test("live renderers use the shared sanitizer for upstream-controlled content", async () => {
  const [reference, detail, follow] = await Promise.all([
    readFile(root("reference-layout.js"), "utf8"),
    readFile(root("team-detail.js"), "utf8"),
    readFile(root("school-follow-logic.js"), "utf8")
  ]);
  assert.match(reference, /LocalBleachersSecurity/);
  assert.match(reference, /esc\(event\.opponent\)/);
  assert.match(reference, /esc\(event\.venue\)/);
  assert.match(detail, /safeUrl\(state\.logo\)/);
  assert.match(detail, /esc\(event\.notes\)/);
  assert.match(follow, /esc\(school\.name\)/);
  assert.match(follow, /esc\(schoolChoiceDetail\(school\)\)/);
});

test("static asset security policy covers CSP, clickjacking, MIME, referrer and geolocation", async () => {
  const headers = await readFile(root("_headers"), "utf8");
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy:/);
  assert.match(headers, /Permissions-Policy: geolocation=\(self\)/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
});

test("existing protected write endpoints still reject requests without server-side tokens", async () => {
  const refresh = await coreWorker.fetch(new Request("https://local.test/api/v1/refresh", { method:"POST" }), {}, {});
  assert.equal(refresh.status, 404);

  const logo = await logoWorker.fetch(new Request(`https://local.test${HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH}`, { method:"POST" }), {}, {});
  assert.equal(logo.status, 404);

  const college = await m4Worker.fetch(new Request("https://local.test/api/v1/m4/college-bootstrap", { method:"POST" }), {}, {});
  assert.equal(college.status, 404);

  const d1Usage = await d1UsageWorker.fetch(new Request("https://local.test/api/v1/d1-usage"), {}, {});
  assert.equal(d1Usage.status, 404);
});
