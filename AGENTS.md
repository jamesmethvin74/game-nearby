# LocalBleachersAR Agent Operating Rules

These rules are mandatory for any coding/operations agent working in this repository.

## LOCALBLEACHERSAR PRODUCTION CONTROL SURFACE — READ THIS FIRST

This repository already has an established production operating model. Do not rediscover it from scratch.

### Canonical control surfaces

- **Production deploy:** Cloudflare Git integration from `feature/live-sports-pipeline-m1`. `backend/package.json` also exposes `npm run prod:deploy` / plain `wrangler deploy` for the project environment when an approved operation explicitly requires it.
- **Production D1:** use Wrangler from the authenticated project environment, e.g. `wrangler d1 execute localbleachersar-sports --remote ...`, preferably through an existing approved script under `backend/scripts/`.
- **Statewide read-only integrity audit, authenticated project shell:** from `backend/`, run **`npm run prod:audit:statewide`**. It executes `buildStatewideDataIntegrityAudit()` against the remote production D1 binding and prints JSON.
- **Statewide read-only integrity audit, ChatGPT/connector runtime with no network-capable project shell:** use the **Cloudflare Git Build audit trampoline** documented in `backend/OPERATIONS.md`. Temporarily set `deploy:cloudflare` to `npm run prod:audit:publish`, commit that one change to the watched branch, let Cloudflare's own build environment execute Wrangler, retrieve the JSON from the stable preview alias, then immediately restore `deploy:cloudflare` to plain `wrangler deploy`. **Do not use GitHub Actions.**
- **General read-only production verification:** run **`npm run prod:verify`** unless a more specific existing script is named by the task.
- **Operational reference:** read `backend/OPERATIONS.md` before inventing any new execution mechanism.

### GitHub Actions are not the production control surface

Do **not** create or use GitHub Actions to perform LocalBleachersAR production deployment, D1 queries, audits, collection, reconciliation, refresh, or repair merely because another Cloudflare action namespace is not surfaced.

A missing direct Cloudflare/plugin namespace is irrelevant when Wrangler/project scripts can perform the approved operation.

GitHub remains the source-control/deployment-status surface. It is not the default production execution engine.

### Do not make the user repeat this

When an approved production operation is requested:

1. read this file;
2. re-anchor the watched branch;
3. choose the documented execution path that matches the runtime: authenticated shell or ChatGPT/no-shell Cloudflare Git Build trampoline;
4. execute the named command/script;
5. retrieve the result;
6. restore any temporary `deploy:cloudflare` trampoline change before reporting completion.

Do not spend the action budget rediscovering Cloudflare connector availability, protected Worker tokens, alternate HTTP transports, or GitHub Actions when a canonical Wrangler/project command already exists.

## Cloudflare access protocol — do not block on action namespaces

Cloudflare is a known connected production service for this project. A missing or unsurfaced direct Cloudflare action namespace is **not** evidence that Cloudflare is unavailable and is **never** by itself a reason to stop work.

### Production facts

- Repository: `jamesmethvin74/game-nearby`
- Cloudflare Worker: `localbleachersar-sports-api`
- Production/watch branch: `feature/live-sports-pipeline-m1`
- Production D1: `localbleachersar-sports`
- Cloudflare Git integration is active and reports Worker deployment state through GitHub via `cloudflare-workers-and-pages[bot]` comments.

### Required Cloudflare workflow

When the task involves Cloudflare, use the project-supported surfaces in this order:

1. **GitHub repository state** — inspect the watched branch, commits, PRs, checks, and relevant files directly.
2. **Cloudflare Git deployment state through GitHub** — inspect the latest `cloudflare-workers-and-pages[bot]` deployment comment. The comment reports success/failure, deployed commit, timestamp, and Cloudflare build-log link. PR #366 is the current deployment-status anchor until superseded by a newer bot status surface.
3. **Production Worker API** — use bounded public/read-only calls to the deployed Worker when live behavior must be verified.
4. **Direct Cloudflare connector/plugin actions** — use them when surfaced and when the operation actually requires them. Their absence does not invalidate steps 1–3.

### Deployment rule

Normal production deployment is driven by the Cloudflare Git integration from the watched branch. `backend/package.json` intentionally maps `deploy:cloudflare` to plain `wrangler deploy`.

Do not:
- treat a missing Cloudflare action namespace as a deployment blocker;
- ask the user to run Wrangler manually merely because a direct Cloudflare namespace is absent;
- create GitHub Actions as a substitute for Cloudflare deployment, collection, cron, or D1 work;
- conflate deployment with heavyweight production verification.

The explicit heavyweight logo proof is `npm run deploy:logo-proof`; it is not the normal deployment path.

### Production D1 safety

Do not initiate bulk production D1 work, remote migrations, large reconciliation/collection jobs, or expensive verification without the user's explicit approval for that production step.

When production D1 work is approved:
- use set-based SQL;
- avoid N+1 queries;
- minimize `rows_read` and `rows_written`;
- use existing indexes;
- combine verification into as few bounded calls as practical.

### Language rule

Do **not** tell the user "Cloudflare is unavailable" or stop with "Cloudflare is installed/enabled but its action namespace is not surfaced" when GitHub deployment status, the production Worker API, repository scripts, or another project-supported surface can complete or advance the task.

Only discuss the direct action namespace if the user explicitly asks about connector/plugin surfacing or if a specific Cloudflare-only operation truly cannot be performed through the project-supported paths.

## General external-service verification

Before claiming any external project service is unavailable:

1. check current project instructions/history;
2. inspect installed plugin/connector state when applicable;
3. inspect available tool/resource actions;
4. attempt an appropriate harmless read-only call through the project-supported path;
5. distinguish between:
   - usable now;
   - installed/connected but a particular direct action surface is absent;
   - a specific attempted action failed;
   - genuinely unavailable.

Never collapse those states into "no access."


## Hard execution governor — mandatory

These rules exist to prevent long diagnostic loops, stale-branch work, temporary-control-surface sprawl, and tasks that end in setup instead of results.

### One operation at a time

- Treat each user-requested task as **one concrete operation with one definition of done**.
- Do not expand the task into adjacent diagnosis, cleanup, repair, verification, refactoring, or architecture work unless the user explicitly asks for that expansion.
- If a task is read-only, remain read-only. Do not modify production code, schemas, routes, workflows, or endpoints merely to make the read-only task easier.
- If the task is an audit, the deliverable is the audit result. If the task is a repair, the deliverable is the repaired production state and verification. If the task is a code change, the deliverable is the requested code change and its direct validation.

### Five-action checkpoint

- After at most **5 meaningful tool actions**, return control to the user with a concrete checkpoint unless the requested operation has already completed.
- A checkpoint must state:
  - what was actually completed;
  - what evidence was obtained;
  - what remains;
  - the exact next operation.
- Do not continue silently past this checkpoint.
- Tool discovery, repeated access checks, and repeated re-reading of the same state count against this budget when they do not directly advance the requested operation.

### Re-anchor before every write session

- Before any repository or production write, verify the current head of `feature/live-sports-pipeline-m1`.
- Never continue implementation from a stale repair branch, stale prompt SHA, or yesterday's checkpoint when the watched branch has advanced.
- If the watched branch advanced, re-evaluate against the current head before writing.
- Do not resurrect or reuse old diagnostic/repair branches as execution bases simply because they contain related work.

### No temporary machinery by default

Do not create a new:
- branch;
- pull request;
- GitHub workflow;
- internal Worker endpoint;
- temporary API route;
- schema object;
- migration;
- diagnostic harness;

unless one of these is true:

1. the user explicitly requested that artifact; or
2. the requested operation is already approved, the established project path genuinely requires a temporary bounded HTTP-transport workflow, and the repository instructions explicitly permit that fallback.

For read-only production audits, **do not modify backend source code to create a new audit route**. Use an existing protected audit surface. If the existing surface cannot be reached after the documented primary path and fallback are attempted, stop and report the exact blocker.

Any permitted temporary transport must be removed immediately after the bounded operation completes.

### No diagnostic loops

- Once the next concrete action is known, execute it.
- Do not spend more than two consecutive tool actions on access, authentication, connector surfacing, or transport.
- After two such actions, use the documented fallback immediately.
- Do not repeatedly inspect secrets, token masking, plugin availability, workflow configuration, or deployment plumbing after the project-supported path is already known.
- Do not create probes whose only purpose is to investigate another probe.

### Setup is not completion

Never report a task complete merely because:
- code was written;
- a commit exists;
- a branch or PR exists;
- CI passed;
- Cloudflare deployed;
- an endpoint exists;
- a workflow was created;
- a repair is "ready to run."

A production operation is complete only after the requested operation actually ran and the resulting production state was retrieved and verified.

### Minimize control surfaces

- Prefer the current watched branch plus existing durable project surfaces.
- Do not leave behind one-shot workflows, expired routes, stale diagnostic PRs, or temporary repair branches as part of the normal operating model.
- Historical artifacts must not be treated as current execution paths.
- PR #366 remains the Cloudflare deployment-status anchor unless these repository instructions explicitly supersede it.

### Communication discipline

- Keep updates short and factual.
- Report concrete results, not narration of routine browsing.
- If blocked, report only after the primary documented path and documented fallback both fail.
- A blocker report must include the exact operation, exact failure, fallback attempted, and why no remaining project-supported path can complete the operation.
- Never disappear into an open-ended investigation after the user has approved a specific bounded operation.

### Control-room discipline

When the user designates a chat as a control room or coordination chat:
- use it to maintain the current production checkpoint, completed operations, and the next atomic objective;
- do not launch broader production work from it unless the user explicitly asks;
- execution prompts should be narrow enough to complete within one bounded operation and the five-action checkpoint rule.
