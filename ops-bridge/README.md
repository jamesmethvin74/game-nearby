# LocalBleachersAR Ops Bridge

A separate read-only Cloudflare Worker that gives ChatGPT and other automation one deterministic public status surface for the production Worker.

## What it exposes

- `GET /health`
- `GET /v1/latest`
- `GET /v1/build?sha=<git-sha>`

The build endpoints query Cloudflare's Workers Builds API for `localbleachersar-sports-api`. Failed builds include a sanitized error summary. The Cloudflare API token is stored only as a Worker secret and is never returned.

## Required Cloudflare secret

`CLOUDFLARE_API_TOKEN`

Create a **user-scoped** Cloudflare API token with only the read permissions needed for:

- Workers CI: Read
- Workers Scripts: Read

Scope it to the LocalBleachersAR account. Do not commit or paste the token.

## Cloudflare deployment

Create a separate Worker named:

`localbleachersar-ops-bridge`

Connect it to this GitHub repository, production branch:

`feature/live-sports-pipeline-m1`

Set the root directory to:

`/ops-bridge`

Deploy command:

`npm run deploy`

Then add `CLOUDFLARE_API_TOKEN` as a secret for the Ops Bridge Worker.

The bridge is intentionally separate from `localbleachersar-sports-api` so production app operation does not depend on the bridge.
