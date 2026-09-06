# Deployment

Everything described here is already deployed and live. This document
explains how, and how to redeploy after changes.

## Contract — GenLayer StudioNet

Deployed manually by the project owner via GenLayer Studio/CLI (never by
an agent, per project rules — an agent must never invent or assume a
contract address). Current deployment:

- Address: `0x5EfaD781bf95e075B6b52E852D3815315b639637` (the **8th**
  deployment of this project — see `memory/MEMORY.md` for why the first
  seven were retired)
- Constructor args: `treasury_address` (the deployer's own wallet),
  `default_fee_bps=250` (2.5%)
- Verify the live schema matches source at any time:
  ```bash
  genlayer network set studionet
  genlayer schema 0x5EfaD781bf95e075B6b52E852D3815315b639637
  ```
- Verify the live *source*, not just the ABI, actually matches the repo
  (the schema alone can't prove internal logic/constants match):
  ```bash
  genlayer code 0x5EfaD781bf95e075B6b52E852D3815315b639637 > /tmp/deployed.py
  diff /tmp/deployed.py contracts/proof_bounty.py
  ```

To redeploy a changed contract:

1. `genvm-lint check contracts/proof_bounty.py --json` — must show
   `"ok": true` with schema validation passing.
2. Deploy via GenLayer Studio/CLI (the project owner's own signed
   transaction).
3. Update `PROOFBOUNTY_CONTRACT_ADDRESS` / `NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS`
   everywhere below, **and** in `scripts/lib-contract.mjs` and
   `memory/MEMORY.md`'s deployment-state table, in the same breath —
   this project has been bitten twice by an audit catching a stale
   address left in one of these places after a redeploy.
4. **Clear the cached database of the old contract's data.** The new
   contract's `bounty_counter` starts fresh at 0 — cached rows from the
   retired contract's bounty ids would collide and confuse the indexer,
   the frontend, and anyone reading the API. Against both local dev and
   production Postgres:
   ```sql
   TRUNCATE TABLE attempts, bounties, reputation, activity_events,
     notifications, evidence_archives RESTART IDENTITY CASCADE;
   UPDATE indexer_state SET last_bounty_count = 0, last_polled_at = now(), last_error = NULL WHERE id = 1;
   ```
5. Redeploy the backend (picks up the new `PROOFBOUNTY_CONTRACT_ADDRESS`
   secret) and the frontend (picks up the new
   `NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS` env var) — see below.

## Frontend — Vercel

- Project: `proof-bounty`, org `adebiyi2002gmailcoms-projects`
- Live URL: **https://proof-bounty.vercel.app**
- Linked via `vercel link --project proof-bounty --scope adebiyi2002gmailcoms-projects`

Redeploy after changes:

```bash
cd apps/web
vercel deploy --prod --yes --scope adebiyi2002gmailcoms-projects
```

Production environment variables (set via `vercel env add ... production`):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS` | `0x5EfaD781bf95e075B6b52E852D3815315b639637` |
| `NEXT_PUBLIC_GENLAYER_NETWORK` | `studionet` |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
| `NEXT_PUBLIC_API_URL` | `https://proofbounty-api.fly.dev` |

To change one: `vercel env rm <NAME> production` then
`vercel env add <NAME> production` (same `--scope` flag), then redeploy.

## Backend — Fly.io

- App: `proofbounty-api`, org `personal`, region `iad`
- Live URL: **https://proofbounty-api.fly.dev**
- Postgres: Fly Postgres cluster `proofbounty-db` (attached via
  `fly postgres attach`, which set `DATABASE_URL` automatically)
- Scaled to **exactly 1 machine** (`fly scale count 1`) — Fly's default
  HA behavior launches 2, which would double-consume the scarce GenLayer
  RPC budget (30 requests/minute, 500/hour, 5,000/day — all real
  StudioNet limits discovered empirically during this project's
  development) for no benefit on this workload.

Redeploy after changes:

```bash
cd apps/api
fly deploy --app proofbounty-api
```

Secrets (set via `fly secrets set ... --app proofbounty-api`):

| Secret | Notes |
|---|---|
| `DATABASE_URL` | Auto-set by `fly postgres attach` |
| `PROOFBOUNTY_CONTRACT_ADDRESS` | `0x5EfaD781bf95e075B6b52E852D3815315b639637` |
| `REDIS_URL` | Upstash instance, used only for GenLayer RPC pacing |

Non-secret env vars live in `apps/api/fly.toml`'s `[env]` block
(`GENLAYER_RPC_URL`, `CORS_ORIGIN`, `INDEXER_POLL_INTERVAL_MS`,
`GENLAYER_RPC_RATE_LIMIT_PER_MINUTE`, `GENLAYER_RPC_RATE_LIMIT_PER_HOUR`,
`GENLAYER_RPC_RATE_LIMIT_PER_DAY` — see `docs/ENVIRONMENT.md` for the
full list and `docs/ARCHITECTURE.md` for why all three windows exist).

### Health checks

- `GET /livez` — bare liveness, what Fly's `http_service.checks` actually
  polls. Deliberately does not depend on the indexer or database, so a
  transient GenLayer RPC hiccup never causes Fly to restart-loop the
  service.
- `GET /health` — indexer/cache status, for humans/dashboards. Returns
  `status: "degraded"` (still `200`, not `503` — the API keeps serving
  cached data) if the last poll errored, most commonly
  `"daily GenLayer RPC budget exhausted, resets in <N>s"` after heavy
  real test volume. This is genuine GenLayer infrastructure behavior,
  not a bug — the indexer resumes on its own once the daily window
  resets; no intervention needed beyond waiting. (The rate limiter
  reports this proactively and immediately now — it used to block the
  poll loop silently for up to the full window instead; see
  `docs/SECURITY.md`'s "Availability incident" note if `/health` is ever
  frozen/stale instead of showing a clear error like this.)

### Database migrations

The Docker image runs `npx prisma migrate deploy` on container start
(see `apps/api/Dockerfile`'s `CMD`), so schema changes ship automatically
on the next `fly deploy` — no separate migration step needed in normal
operation. To run one manually against production:

```bash
fly ssh console --app proofbounty-api -C "npx prisma migrate deploy"
```

## Local development

```bash
# Backend
cd apps/api
cp .env.example .env        # fill in REDIS_URL yourself (get a free Upstash instance)
docker compose up -d         # Postgres on localhost:5443
npx prisma migrate dev
npm run dev                  # http://localhost:8080

# Frontend (separate terminal)
cd apps/web
npm run dev                  # http://localhost:3000
```

`apps/web/.env.local` already points at the production contract and
backend by default — override `NEXT_PUBLIC_API_URL=http://localhost:8080`
locally if you want the frontend talking to your local backend instead.
