# LocalBleachersAR sports backend

Milestone 1 backend: Cloudflare Worker + Cron Trigger + D1. **No GitHub Actions are used.**

## Pilot sources

- UCA football — official UCA Athletics (Sidearm)
- UCA men's soccer — official UCA Athletics (Sidearm); includes completed-result parsing
- Hendrix football — official Hendrix Athletics (Sidearm)
- Conway football — official Conway Athletics / Mascot Media

The collector keeps last known good data. A failed fetch or suspiciously empty parse records a failure but does not delete existing games.

## Bootstrap

```bash
cd backend
npm install
npx wrangler whoami
npx wrangler d1 create localbleachersar-sports
# Put the returned database_id into wrangler.jsonc.
npx wrangler d1 migrations apply localbleachersar-sports --remote
npx wrangler secret put REFRESH_TOKEN
npx wrangler deploy
```

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
