const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const PAID_INCLUDED_READS = 25_000_000_000;
const PAID_INCLUDED_WRITES = 50_000_000;
const FREE_DAILY_READS = 5_000_000;
const FREE_DAILY_WRITES = 100_000;

const D1_USAGE_QUERY = `
query LocalBleachersD1Usage(
  $accountTag: string!
  $start: Date
  $end: Date
  $databaseId: string
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }
        orderBy: [date_ASC]
      ) {
        sum {
          rowsRead
          rowsWritten
          readQueries
          writeQueries
        }
        dimensions {
          date
          databaseId
        }
      }
    }
  }
}`;

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function utcDate(value) {
  return value.toISOString().slice(0, 10);
}

function monthStart(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function percent(value, limit) {
  return limit > 0 ? Number(((value / limit) * 100).toFixed(6)) : null;
}

function paidOverage(rowsRead, rowsWritten) {
  const excessReads = Math.max(0, rowsRead - PAID_INCLUDED_READS);
  const excessWrites = Math.max(0, rowsWritten - PAID_INCLUDED_WRITES);
  const readCost = (excessReads / 1_000_000) * 0.001;
  const writeCost = (excessWrites / 1_000_000) * 1;
  return {
    excess_rows_read: excessReads,
    excess_rows_written: excessWrites,
    estimated_read_overage_usd: Number(readCost.toFixed(6)),
    estimated_write_overage_usd: Number(writeCost.toFixed(6)),
    estimated_total_overage_usd: Number((readCost + writeCost).toFixed(6))
  };
}

function aggregate(groups = []) {
  return groups.reduce((acc, group) => {
    const sum = group?.sum || {};
    acc.rows_read += asNumber(sum.rowsRead);
    acc.rows_written += asNumber(sum.rowsWritten);
    acc.read_queries += asNumber(sum.readQueries);
    acc.write_queries += asNumber(sum.writeQueries);
    return acc;
  }, { rows_read: 0, rows_written: 0, read_queries: 0, write_queries: 0 });
}

export function summarizeD1Usage(groups = [], now = new Date()) {
  const today = utcDate(now);
  const month = monthStart(now);
  const todayGroups = groups.filter(group => group?.dimensions?.date === today);
  const monthGroups = groups.filter(group => {
    const date = String(group?.dimensions?.date || "");
    return date >= month && date <= today;
  });
  const todayUsage = aggregate(todayGroups);
  const monthUsage = aggregate(monthGroups);
  return {
    generated_at: now.toISOString(),
    source: "cloudflare-graphql-analytics",
    note: "Analytics API only; generating this report does not execute a D1 database query.",
    today: {
      date: today,
      ...todayUsage
    },
    month_to_date: {
      start_date: month,
      end_date: today,
      ...monthUsage,
      paid_allowance: {
        included_rows_read: PAID_INCLUDED_READS,
        included_rows_written: PAID_INCLUDED_WRITES,
        rows_read_percent_used: percent(monthUsage.rows_read, PAID_INCLUDED_READS),
        rows_written_percent_used: percent(monthUsage.rows_written, PAID_INCLUDED_WRITES)
      },
      ...paidOverage(monthUsage.rows_read, monthUsage.rows_written)
    }
  };
}

export function publicBudgetSnapshot(report = {}) {
  const today = report.today || {};
  const month = report.month_to_date || {};
  const rowsReadToday = asNumber(today.rows_read);
  const rowsWrittenToday = asNumber(today.rows_written);
  const rowsReadMonth = asNumber(month.rows_read);
  const rowsWrittenMonth = asNumber(month.rows_written);
  return {
    generated_at: report.generated_at || null,
    today: {
      date: today.date || null,
      rows_read: rowsReadToday,
      rows_written: rowsWrittenToday,
      free_daily_reference: {
        rows_read_limit: FREE_DAILY_READS,
        rows_written_limit: FREE_DAILY_WRITES,
        rows_read_percent_used: percent(rowsReadToday, FREE_DAILY_READS),
        rows_written_percent_used: percent(rowsWrittenToday, FREE_DAILY_WRITES),
        within_limits: rowsReadToday <= FREE_DAILY_READS && rowsWrittenToday <= FREE_DAILY_WRITES
      }
    },
    month_to_date: {
      start_date: month.start_date || null,
      end_date: month.end_date || null,
      rows_read: rowsReadMonth,
      rows_written: rowsWrittenMonth,
      paid_allowance: {
        included_rows_read: PAID_INCLUDED_READS,
        included_rows_written: PAID_INCLUDED_WRITES,
        rows_read_percent_used: percent(rowsReadMonth, PAID_INCLUDED_READS),
        rows_written_percent_used: percent(rowsWrittenMonth, PAID_INCLUDED_WRITES)
      },
      estimated_overage_usd: paidOverage(rowsReadMonth, rowsWrittenMonth).estimated_total_overage_usd
    }
  };
}

export async function loadD1Usage(env, { fetchImpl = fetch, now = new Date() } = {}) {
  const token = String(env.CLOUDFLARE_ANALYTICS_TOKEN || "").trim();
  const accountTag = String(env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const databaseId = String(env.D1_DATABASE_ID || "").trim();
  if (!token) throw new Error("CLOUDFLARE_ANALYTICS_TOKEN is not configured");
  if (!accountTag) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");
  if (!databaseId) throw new Error("D1_DATABASE_ID is not configured");

  const end = utcDate(now);
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = utcDate(startDate);
  const response = await fetchImpl(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: D1_USAGE_QUERY,
      variables: { accountTag, start, end, databaseId }
    })
  });

  if (!response.ok) throw new Error(`Cloudflare Analytics HTTP ${response.status}`);
  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(`Cloudflare Analytics: ${payload.errors.map(error => error.message).join("; ")}`);
  }
  const accounts = payload?.data?.viewer?.accounts || [];
  const groups = accounts.flatMap(account => account?.d1AnalyticsAdaptiveGroups || []);
  return {
    database_id: databaseId,
    ...summarizeD1Usage(groups, now)
  };
}
