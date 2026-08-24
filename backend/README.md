# LocalBleachersAR sports backend

Milestone 1 backend: Cloudflare Worker + Cron Trigger + D1. **No GitHub Actions are used.**

## Cloudflare resources

- Worker: `localbleachersar-sports-api`
- D1 database: `localbleachersar-sports`
- D1 database ID: `50806cc9-7710-4f21-8ab3-159623f6a0a9`
- D1 binding: `DB`
- Cron: hourly at minute 17 UTC (`17 * * * *`)

## Pilot sources

- UCA football — official UCA Athletics (Sidearm)
- UCA men's soccer — official UCA Athletics (Sidearm); includes completed-result parsing
- Hendrix football — official Hendrix Athletics (Sidearm)
- Conway football — official Conway Athletics / Mascot Media

The collector keeps last known good data. A failed fetch or suspiciously empty parse records a failure but does not delete existing games.

## Cloudflare Workers Builds

Import `jamesmethvin74/game-nearby` in Cloudflare Workers Builds with:

- Production branch: `feature/live-sports-pipeline-m1` while Milestone 1 is being verified
- Root directory: `backend`
- Deploy command: `npm run deploy:cloudflare`

That deploy command applies pending D1 migrations to the remote database before deploying the Worker. It does not use GitHub Actions.

## Local development

```bash
cd backend
npm install
npm run check
npm run db:migrate:local
npm run dev
```

For a protected manual refresh, configure a Worker secret named `REFRESH_TOKEN` and POST to `/api/v1/refresh` with the same value in the `x-refresh-token` header.

Trigger a single source manually after deployment:

```bash
curl -X POST 'https://<worker>/api/v1/refresh' \
  -H 'content-type: application/json' \
  -H 'x-refresh-token: <secret>' \
  --data '{"sourceId":"uca-mens-soccer-official"}'
```

Then verify:

```bash
curl 'https://<worker>/api/v1/teams/uca-mens-soccer-2026/schedule'
curl 'https://<worker>/api/v1/teams/uca-mens-soccer-2026/record'
curl 'https://<worker>/api/v1/sources'
```

The hourly Cron is smart: during a game window it uses the source's hourly result cadence; otherwise it falls back to the slower schedule cadence.
