# LocalBleachersAR Agent Operating Rules

These rules are mandatory for any coding/operations agent working in this repository.

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
