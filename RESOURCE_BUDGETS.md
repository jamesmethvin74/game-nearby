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
13. **Team-scoped work must stay team-scoped in SQL.** A one-team record rebuild must not load statewide FINAL rows and discard them in JavaScript. Team restrictions belong in the D1 query so indexes can constrain rows_read.
14. **Every scheduled source collector has a hard fan-out ceiling.** `scope: "all"` is not permission to enumerate every enabled source in one Worker invocation. Ordinary 6 AM / 3 PM / 11 PM passes rotate the oldest-due sources with a maximum of four selected sources per run.
15. **High-frequency statewide volleyball checks are semantic probes, not refreshes.** During the fall live-result window the Worker performs one bounded state read, fetches the single certified statewide varsity volleyball feed, and writes zero D1 rows when the semantic signature is unchanged. Only a changed score/status/schedule snapshot is allowed to enter the existing authoritative statewide ingest path. If a result-ready match remains SCHEDULED afterward, only configured official-school girls-volleyball result pages are eligible for the fallback, with a hard 64-source ceiling.

## Production collection cadence

The Worker receives a lightweight cron tick every 30 minutes so the schedule stays correct through Central Daylight and Standard Time. The tick itself performs no D1 work unless it matches one of the local collection windows below.

- **6:00 AM Central daily:** overnight results/corrections and normal due-source refresh, max 4 due team sources selected.
- **3:00 PM Central daily:** schedule, cancellation, time, and venue changes outside event-day overrides, max 4 due team sources selected.
- **11:00 PM Central daily:** evening finals outside event-day overrides, max 4 due team sources selected.
- **Monday-Friday during August-November, 4:30 PM through 10:30 PM Central, every 30 minutes:** one statewide varsity-volleyball semantic result probe, followed only for unresolved result-ready matches by the bounded official-school volleyball fallback. An unchanged statewide feed performs zero D1 writes before that fallback selection.
- **Friday 8:30 PM through 1:00 AM Saturday Central, every 30 minutes:** football result window only for the scoped core collector; during August-November the same tick also performs the single statewide volleyball semantic probe. At most 16 football source refreshes can be selected on one tick; the existing broad official-final reconciliation pass handles configured school-operated result pages.
- **Saturday 10:30 AM through 1:00 AM Sunday, every 30 minutes:** college result window only for the scoped core collector. During August-November the statewide volleyball semantic probe and its volleyball-only official-school fallback run hourly on the top-of-hour ticks to catch tournament finals. At most 8 college source refreshes can be selected on one tick.
- **Sunday 4:00 AM Central:** catalog discovery, school location matching, branding maintenance, and statewide maintenance collection.

Friday 11:00 PM is naturally part of the half-hour Friday cadence; it is not executed twice. During the Saturday college window, the normal 3 PM and 11 PM passes are likewise not executed as separate duplicate jobs.

The ordinary paths use each source's configured `refresh_minutes`, select oldest-checked due sources first, and stop after the hard four-source ceiling. This prevents the daily collector from turning one cron tick into an unrestricted statewide per-source loop.

The frequent paths are further bounded by game state and expected finish windows. For example, football does not enter frequent polling until roughly two hours after kickoff, and completed/canceled/postponed games stop being eligible immediately. With the current per-tick ceilings, the Friday-night plus pre-reset Saturday frequent work is bounded before the status/time filters reduce it further.

The volleyball live path is bounded differently: it fetches one statewide DragonFly feed, compares a semantic signature against one persisted state row, and exits without D1 writes if nothing changed. A changed snapshot reuses the already-fetched payload for the existing authoritative statewide ingest rather than fetching the provider a second time. After statewide authority runs, the school-operated fallback can only select girls-volleyball teams whose known-time match is still SCHEDULED and at least 90 minutes past start; it polls at most 64 configured official result sources and stops on quota/server failures.

The cadence is implemented with `America/Chicago` local-time gating rather than hard-coded UTC hours, so DST changes do not shift the intended collection times.

## Current safeguards

- `production-statewide-smoke.yml` is manual-only and keeps production verification bounded.
- The all-team result/record audit requires `workflow_dispatch` plus the explicit `full_statewide_record_audit` input.
- `school-schedule.js` performs sequential, capped team endpoint discovery and stops on server/quota failures.
- Successful team schedules are persisted locally and can fall back to recent last-good nearby events.
- Public GETs consult Cloudflare edge cache before D1, with separate short fresh TTLs and longer last-good fallbacks.
- The production collector no longer runs catalog discovery, GIS matching, and branding maintenance on every scheduled invocation.
- Ordinary scheduled core collection is routed through the same bounded source selector as event-day collection instead of falling through to the unbounded all-source loop.
- Team record rebuilds put the requested team IDs in the canonical/raw FINAL SQL predicates rather than filtering statewide result sets in JavaScript.
- D1 indexes cover reporting-team canonical members, team record lookups, source/time lookups, opponent/time reconciliation lookups, and enabled-source cadence ordering.
- Friday/Saturday frequent collection uses small per-tick source ceilings and only polls games in result-ready windows.
- The statewide DragonFly collector skips bulk D1 rewrites when its semantic schedule/result fingerprint has not changed.
- Fall live-volleyball probes use one state read and zero D1 writes for unchanged snapshots; changed snapshots reuse the fetched payload for authoritative ingest.
- Live volleyball official-school fallback is restricted to configured girls-volleyball Mascot Media/RankOne result pages, result-ready SCHEDULED games, a 30-minute due interval, and 64 sources maximum per invocation.
- Standings GETs never rebuild or persist records; volleyball standings use bounded, set-based reads limited to the displayed published conference roster.
- `backend/budget-tests/` contains regression tests for collection cadence, query scoping, index availability, and resource-budget protections.

## Next architecture improvement

Replace frontend sport-by-sport probing with a single read-only school schedule endpoint, for example:

`GET /api/v1/schools/:schoolId/schedule`

That endpoint should use indexed joins to return all currently supported active teams and schedules for a school in one bounded D1 read path. Once that exists, the frontend three-request cap can be reduced to one request per school open.
