# LocalBleachersAR Production Operations

This is the durable production operations reference for agents and maintainers.

## Production facts

- Repository: `jamesmethvin74/game-nearby`
- Watched / production branch: `feature/live-sports-pipeline-m1`
- Worker: `localbleachersar-sports-api`
- D1 database: `localbleachersar-sports`
- Wrangler config: `backend/wrangler.jsonc`
- Production deployment: Cloudflare Git integration from the watched branch
- Authoritative deployment-status path: exact commit SHA -> GitHub check-runs -> `Workers Builds: localbleachersar-sports-api`
- Ops Bridge: `https://localbleachers-ops.methvindigitalworks.com`

## Rules that matter most

1. Read `/AGENTS.md` first.
2. Re-anchor `feature/live-sports-pipeline-m1` before writes.
3. Prefer existing scripts and Wrangler commands over inventing a new transport.
4. GitHub Actions are not the production execution surface. The sole automatic exception is a temporary fixed-target one-shot workflow used only as HTTP transport when ChatGPT runtime egress blocks an already-approved endpoint; delete it immediately after retrieval.
5. Missing connector/action namespaces are never evidence that GitHub or Cloudflare is unavailable. Use the documented fallback surfaces immediately.
6. Production D1 writes, migrations, collection/reconciliation, refreshes, and repairs require explicit approval.
7. Read-only production work must remain read-only.
8. Do not create a new audit route merely to run an audit.

## Authoritative GitHub / Cloudflare availability contract

Never use connector/plugin surfacing as the test for whether this project can use GitHub or Cloudflare.

For build/deployment status:

1. resolve the exact commit SHA;
2. read that commit's GitHub check-runs;
3. select `Workers Builds: localbleachersar-sports-api`;
4. use its `status`, `conclusion`, Cloudflare Build ID (`external_id`), version ID when present, and `details_url`.

The LocalBleachersAR Ops Bridge exposes the same exact-build truth at:

```text
GET https://localbleachers-ops.methvindigitalworks.com/health
GET https://localbleachers-ops.methvindigitalworks.com/v1/build?sha=<git-sha>
```

The bridge's **primary** source is the GitHub Cloudflare check-run. A Cloudflare API token is optional and is used only to enrich failed builds with sanitized log detail. Missing/expired/under-permissioned Cloudflare API auth must not make an otherwise valid exact-build lookup fail.

If the current ChatGPT runtime cannot directly fetch the Ops Bridge hostname, use the exact GitHub check-run directly. That is a transport limitation of that runtime, **not** evidence that Cloudflare is unavailable.

Do not stop, ask the user to inspect a dashboard, or switch to GitHub Actions merely because a direct Cloudflare action namespace is absent.

## ChatGPT HTTP egress fallback — mandatory

Generic ChatGPT web/container HTTP access to Cloudflare Worker hostnames is not part of the LocalBleachersAR control plane.

If a direct request to the Ops Bridge, a production Worker endpoint, or an audit-result Worker is rejected by the ChatGPT runtime before an HTTP response is received, **do not stop and do not report Cloudflare/GitHub unavailable**.

Use a temporary fixed-target GitHub workflow as HTTP transport only:

1. create a one-shot workflow on the watched branch containing only the exact approved URL(s);
2. use `curl` to capture HTTP status and bounded response content;
3. if authentication is required, consume only an existing repository secret without revealing its value;
4. read the workflow result/log through the GitHub connector;
5. delete the workflow immediately.

This exception exists solely to move HTTP bytes between an existing deployed endpoint and ChatGPT. It does not replace Cloudflare deployment, D1, collection, cron, reconciliation, refresh, or repair architecture.

A runtime `DisabledError` or blocked Worker hostname must never be surfaced as the final blocker while this fallback can execute.

## ChatGPT / connector runtime: statewide audit through Cloudflare Git Build

Use this path when the agent can write GitHub through the connector but **cannot** run an authenticated network-capable project shell. This is the canonical ChatGPT execution path and avoids both GitHub Actions and protected Worker-token transport.

The durable helper is:

```bash
npm run prod:audit:publish
```

That helper:

1. runs inside the **Cloudflare Git Build** environment;
2. creates an ephemeral preview execution worker bound to the configured production D1 database;
3. invokes `buildStatewideDataIntegrityAudit()` exactly once;
4. verifies the audit reports zero D1 rows written;
5. replaces the execution preview with a read-only result worker at the stable alias:
   `https://statewide-integrity-audit-result-localbleachersar-sports-api.james-methvin74.workers.dev/api/statewide-integrity-audit-result`;
6. removes its temporary local wrapper files before the build exits;
7. does **not** deploy a new production Worker route;
8. does **not** use `REFRESH_TOKEN`;
9. does **not** use GitHub Actions.

### Agent procedure

The entire operation is:

1. Read `AGENTS.md` and verify the watched-branch head.
2. Through the GitHub connector, change only `backend/package.json`:
   `"deploy:cloudflare": "npm run prod:audit:publish"`.
3. Read that exact commit's GitHub check-runs and select `Workers Builds: localbleachersar-sports-api`; do not rely on PR #366 comments as the primary status source.
4. On successful Cloudflare build, fetch the stable result alias above and retrieve the audit JSON.
5. Immediately restore `"deploy:cloudflare": "wrangler deploy"` through the GitHub connector.

The temporary deploy-command change is an execution trigger only. The helper itself publishes a preview result and **does not deploy the production Worker**. The restore commit returns the watched branch to the normal production deployment contract.

Do not clone the repository into a generic ChatGPT shell. Do not test connector/plugin surfacing as a prerequisite. Use the established GitHub repository surface and exact-commit Cloudflare check-run. Do not substitute GitHub Actions.

## Canonical commands

Run these from `backend/`.

### Statewide production integrity audit — READ ONLY

```bash
npm run prod:audit:statewide
```

Implementation:

```text
scripts/run-statewide-integrity-audit.sh
  -> Wrangler remote development
  -> production D1 binding: localbleachersar-sports
  -> buildStatewideDataIntegrityAudit(env, { season: "2026", sampleLimit: 1000 })
  -> JSON written to stdout
```

Properties:

- read-only;
- no GitHub Actions;
- no protected production HTTP token;
- no production Worker route added;
- no production Worker deploy;
- no D1 write;
- temporary local wrapper is removed automatically;
- uses the same audit implementation used by the durable Worker audit surface.

Override the audit season or sample cap only when the task explicitly calls for it:

```bash
AUDIT_SEASON=2026 AUDIT_SAMPLE_LIMIT=1000 npm run prod:audit:statewide
```

### General production verification — READ ONLY

```bash
npm run prod:verify
```

Today this intentionally maps to the statewide integrity audit because that is the broad canonical data-accuracy verification. Use a narrower existing verification script when the task names a narrower subsystem.

### Deploy

Normal production deployment is via Cloudflare Git integration from the watched branch.

When an already-approved operation explicitly requires invoking Wrangler deployment from the authenticated project environment:

```bash
npm run prod:deploy
```

This is an alias for plain `wrangler deploy`. It is not permission to deploy without approval.

### Direct bounded D1 read

For a specific bounded read when no existing script already covers it:

```bash
wrangler d1 execute localbleachersar-sports --remote --command="<SET-BASED SELECT>" --json
```

Keep reads bounded and set-based. Prefer one combined verification query over repeated calls.

## Existing scripts are the examples

Before inventing an operational path, inspect the relevant existing script under `backend/scripts/`.

Examples already in this repository demonstrate the intended control surface:

- `verify-hootens-production-readonly.sh` — direct read-only production D1 verification through Wrangler.
- `run-approved-official-final-results-activation.sh` — approved bounded production execution through Wrangler with explicit safety gates.
- `run-approved-hootens-complete-catchup.sh` — bounded approved production execution and combined verification.
- `run-college-logo-app-audit.sh` — production D1 read plus app/API validation.

These examples are evidence that the project control surface is Wrangler/project scripts, not GitHub Actions.

## Statewide audit internals

The audit implementation is:

```text
backend/src/statewide-data-integrity-audit.js
```

Primary function:

```js
buildStatewideDataIntegrityAudit(env, {
  season: "2026",
  now: new Date(),
  sampleLimit: 1000
})
```

The production Worker also exposes a protected durable route:

```text
GET /api/v1/coverage-report?view=data-integrity
```

Do not waste time obtaining or moving the production `REFRESH_TOKEN` merely to run the audit. The canonical operator command is `npm run prod:audit:statewide`, which executes the same audit function with the remote production D1 binding through Wrangler.

## GitHub Actions

Do not use GitHub Actions for ordinary LocalBleachersAR operations.

Specifically, do not use Actions as a substitute for:

- Cloudflare deployment;
- production audit execution;
- D1 reads or writes;
- collection;
- reconciliation;
- refresh;
- production repair.

If an exceptional task truly requires GitHub Actions, the user must explicitly request that execution path or `AGENTS.md` must explicitly require it for that exact operation.

## Safety reminder

A command existing in this document does not grant write approval. Production writes still require the user's explicit approval for the bounded operation.
