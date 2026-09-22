# LocalBleachersAR Production Operations

This is the durable production operations reference for agents and maintainers.

## Production facts

- Repository: `jamesmethvin74/game-nearby`
- Watched / production branch: `feature/live-sports-pipeline-m1`
- Worker: `localbleachersar-sports-api`
- D1 database: `localbleachersar-sports`
- Wrangler config: `backend/wrangler.jsonc`
- Production deployment: Cloudflare Git integration from the watched branch
- Deployment-status anchor: PR #366 unless superseded in `AGENTS.md`

## Rules that matter most

1. Read `/AGENTS.md` first.
2. Re-anchor `feature/live-sports-pipeline-m1` before writes.
3. Prefer existing scripts and Wrangler commands over inventing a new transport.
4. GitHub Actions are not the production execution surface unless the user explicitly requests Actions.
5. Do not interpret an unsurfaced Cloudflare plugin namespace as lack of Cloudflare access.
6. Production D1 writes, migrations, collection/reconciliation, refreshes, and repairs require explicit approval.
7. Read-only production work must remain read-only.
8. Do not create a new audit route merely to run an audit.

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
   `https://statewide-integrity-audit-result-localbleachersar-sports-api.james-methvin74.workers.dev/`;
6. removes its temporary local wrapper files before the build exits;
7. does **not** deploy a new production Worker route;
8. does **not** use `REFRESH_TOKEN`;
9. does **not** use GitHub Actions.

### Agent procedure

The entire operation is:

1. Read `AGENTS.md` and verify the watched-branch head.
2. Through the GitHub connector, change only `backend/package.json`:
   `"deploy:cloudflare": "npm run prod:audit:publish"`.
3. Wait for the `cloudflare-workers-and-pages[bot]` status on PR #366 for that exact commit.
4. On successful Cloudflare build, fetch the stable result alias above and retrieve the audit JSON.
5. Immediately restore `"deploy:cloudflare": "wrangler deploy"` through the GitHub connector.

The temporary deploy-command change is an execution trigger only. The helper itself publishes a preview result and **does not deploy the production Worker**. The restore commit returns the watched branch to the normal production deployment contract.

Do not clone the repository into a generic ChatGPT shell. Do not test whether the generic runtime can reach GitHub. Do not inspect plugin surfacing. Do not substitute GitHub Actions.

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
