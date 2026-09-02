# LocalBleachersAR resource budgets

LocalBleachersAR must treat hosted-service quotas as production capacity, not as an afterthought.

## Cloudflare D1 free-plan limits

As of September 1, 2026, Cloudflare hard-enforces the Workers Free D1 daily limits:

- Rows read: 5,000,000 per day
- Rows written: 100,000 per day
- Reset: 00:00 UTC
- Queries per Worker invocation: 50 on Workers Free

Once the daily read or write limit is reached, D1 queries fail until the reset. Stored data is not lost.

## Engineering rules

1. **GET routes are read-only.** User-triggered reads must never rebuild records, refresh catalogs, reconcile statewide data, or perform maintenance writes.
2. **No automatic statewide fan-out.** Any workflow that walks every school/team and calls production D1 endpoints must be manual-only and explicitly opted into.
3. **Automatic production smoke tests are bounded.** A smoke test should prove a few representative paths, not audit the database through the public API.
4. **Retries are bounded and short.** Production probes should normally use no more than three attempts. A quota/server failure must not trigger a request storm.
5. **UI fan-out is capped.** One user action must not blindly call every possible sport/team endpoint. Team detail currently caps candidate schedule requests at three and stops on the first non-404 server failure.
6. **Prefer one indexed query over many small route calls.** The next schedule API evolution should aggregate school schedules server-side so the client can make one request per school.
7. **Cache last-good public data.** Catalog, nearby games, and team schedules should remain usable during a temporary D1 outage or quota lockout.
8. **Indexes are part of the budget.** New D1 queries that filter or join large tables require an index review before deployment.
9. **Do not use CI as a load test.** Broad correctness audits belong in local/in-memory tests where possible. Production-wide verification should be deliberate and infrequent.
10. **Estimate before adding recurring work.** For any new job or route, consider: requests per run × runs per day × approximate rows read/written per request.

## Current safeguards

- `production-statewide-smoke.yml` keeps automatic production checks small.
- The all-team result/record audit requires `workflow_dispatch` plus the explicit `full_statewide_record_audit` input.
- `school-schedule.js` performs sequential, capped team endpoint discovery and stops on server/quota failures.
- Successful team schedules are persisted locally and can fall back to recent last-good nearby events.
- `backend/test/resource-budget-guard.test.js` prevents the key guardrails from being casually removed.

## Next architecture improvement

Replace frontend sport-by-sport probing with a single read-only school schedule endpoint, for example:

`GET /api/v1/schools/:schoolId/schedule`

That endpoint should use indexed joins to return all currently supported active teams and schedules for a school in one bounded D1 read path. Once that exists, the frontend three-request cap can be reduced to one request per school open.
