import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import usageApp from "../src/d1-usage-public-worker.js";
import { loadD1Usage, summarizeD1Usage } from "../src/d1-usage-monitor.js";

const NOW = new Date("2026-09-03T16:00:00.000Z");

function sampleGroups() {
  return [
    {
      dimensions: { date: "2026-09-01", databaseId: "db-1" },
      sum: { rowsRead: 1_000_000, rowsWritten: 2_000, readQueries: 100, writeQueries: 10 }
    },
    {
      dimensions: { date: "2026-09-02", databaseId: "db-1" },
      sum: { rowsRead: 2_000_000, rowsWritten: 3_000, readQueries: 200, writeQueries: 20 }
    },
    {
      dimensions: { date: "2026-09-03", databaseId: "db-1" },
      sum: { rowsRead: 4_000_000, rowsWritten: 5_000, readQueries: 300, writeQueries: 30 }
    }
  ];
}

test("D1 usage summary reports today and month-to-date paid allowance consumption", () => {
  const summary = summarizeD1Usage(sampleGroups(), NOW);
  assert.equal(summary.today.rows_read, 4_000_000);
  assert.equal(summary.today.rows_written, 5_000);
  assert.equal(summary.month_to_date.rows_read, 7_000_000);
  assert.equal(summary.month_to_date.rows_written, 10_000);
  assert.equal(summary.month_to_date.paid_allowance.included_rows_read, 25_000_000_000);
  assert.equal(summary.month_to_date.paid_allowance.included_rows_written, 50_000_000);
  assert.equal(summary.month_to_date.estimated_total_overage_usd, 0);
});

test("D1 usage loader uses Cloudflare Analytics API without touching the D1 binding", async () => {
  const env = {
    CLOUDFLARE_ANALYTICS_TOKEN: "read-only-token",
    CLOUDFLARE_ACCOUNT_ID: "acct-1",
    D1_DATABASE_ID: "db-1",
    DB: new Proxy({}, { get() { throw new Error("D1 must not be accessed by the usage monitor"); } })
  };
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: sampleGroups() }] } }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const report = await loadD1Usage(env, { fetchImpl, now: NOW });
  assert.equal(report.database_id, "db-1");
  assert.equal(report.today.rows_read, 4_000_000);
  assert.match(request.url, /api\.cloudflare\.com\/client\/v4\/graphql/);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer read-only-token");
});

test("usage monitor source contains no D1 binding calls", () => {
  const source = fs.readFileSync(new URL("../src/d1-usage-monitor.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /env\.DB/);
  assert.doesNotMatch(source, /\.prepare\(/);
});

test("usage endpoint is hidden without the existing refresh token", async () => {
  const env = {
    REFRESH_TOKEN: "private-refresh-token",
    DB: new Proxy({}, { get() { throw new Error("D1 must not be accessed for unauthorized usage requests"); } })
  };
  const response = await usageApp.fetch(new Request("https://example.test/api/v1/d1-usage"), env, {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("usage endpoint does not advertise public CORS or public caching", () => {
  const source = fs.readFileSync(new URL("../src/d1-usage-public-worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /access-control-allow-origin/i);
  assert.doesNotMatch(source, /public,\s*max-age/i);
  assert.match(source, /x-refresh-token/);
});
