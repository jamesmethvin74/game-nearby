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
11. **Frequent polling is result-oriented, not schedule-oriented.** A team is eligible for the 30-minute Friday/Saturday path only after a known-time game is far enough past kickoff/start that a final result could reasonably exist. Once the stored game is FINAL, CANCELED, or POSTPONED, that source drops out of the frequent path.
12. **Do not rewrite an unchanged statewide feed.** The statewide DragonFly collector fingerprints game identity, date/time, status, venue, and participant scores/results. If the semantic snapshot is unchanged, it refreshes lightweight source/state freshness only and skips game/canonical/member upserts and statewide record rebuilding.

## Production collection cadence

The Worker receives a lightweight cron tick every 30 minutes so the schedule stays correct through Central Daylight and Standard Time. The tick itself performs no D1 work unless it matches one of the local collection windows below.

- **6:00 AM Central daily:** overnight results/corrections and normal due-source refresh.
- **3:00 PM Central daily:** schedule, cancellation, time, and venue changes outside event-day overrides.
- **11:00 PM Central daily:** evening finals outside event-day overrides.
- **Friday 8:30 PM through midnight Central, every 30 minutes:** football result window only. At most 16 source refreshes can be selected on one tick.
- **Saturday 10:30 AM through 1:00 AM Sunday, every 30 minutes:** college result window only. At most 8 source refreshes can be selected on one tick.
- **Sunday 4:00 AM Central:** catalog discovery, school location matching, branding maintenance, and statewide maintenance collection.

Friday 11:00 PM is naturally part of the half-hour Friday cadence; it is not executed twice. During the Saturday college window, the normal 3 PM and 11 PM passes are likewise not executed as separate duplicate jobs.

The frequent paths are further bounded by game state and expected finish windows. For example, football does not enter frequent polling until roughly two hours after kickoff, and completed/canceled/postponed games stop being eligible immediately. With the current per-tick ceilings, the Friday-night plus pre-reset Saturday frequent work is bounded to at most a few hundred source attempts in a Cloudflare UTC quota day even before the status/time filters reduce it further.

The cadence is implemented with `America/Chicago` local-time gating rather than hard-coded UTC hours, so DST changes do not shift the intended collection times.

## Current safeguards

- `production-statewide-smoke.yml` is manual-only and keeps production verification bounded.
- The all-team result/record audit requires `workflow_dispatch` plus the explicit `full_statewide_record_audit` input.
- `school-schedule.js` performs sequential, capped team endpoint discovery and stops on server/quota failures.
- Successful team schedules are persisted locally and can fall back to recent last-good nearby events.
- Public GETs consult Cloudflare edge cache before D1, with separate short fresh TTLs and longer last-good fallbacks.
- The production collector no longer runs catalog discovery, GIS matching, and branding maintenance on every scheduled invocation.
- Friday/Saturday frequent collection uses small per-tick source ceilings and only polls games in result-ready windows.
- The statewide DragonFly collector skips bulk D1 rewrites when its semantic schedule/result fingerprint has not changed.
- `backend/budget-tests/` contains regression tests for collection cadence and resource-budget protections.

## Next architecture improvement

Replace frontend sport-by-sport probing with a single read-only school schedule endpoint, for example:

`GET /api/v1/schools/:schoolId/schedule`

That endpoint should use indexed joins to return all currently supported active teams and schedules for a school in one bounded D1 read path. Once that exists, the frontend three-request cap can be reduced to one request per school open.
