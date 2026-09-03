import test from "node:test";
import assert from "node:assert/strict";

const URL = "https://localbleachersar-sports-api.james-methvin74.workers.dev/api/v1/d1-budget";

test("one-time live D1 budget probe", async () => {
  const response = await fetch(URL, { headers: { accept: "application/json" }, cache: "no-store" });
  const text = await response.text();
  console.log("LOCALBLEACHERS_D1_BUDGET_PROBE", text);
  assert.equal(response.status, 200, `budget endpoint HTTP ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  assert.equal(typeof payload?.today?.rows_read, "number");
  assert.equal(typeof payload?.today?.rows_written, "number");
  assert.equal(typeof payload?.month_to_date?.rows_read, "number");
  assert.equal(typeof payload?.month_to_date?.rows_written, "number");
});
