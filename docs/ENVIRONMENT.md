# Environment variables

## `apps/web` (Next.js frontend)

All frontend env vars are `NEXT_PUBLIC_*` — they are bundled into the
client-side JavaScript and visible to anyone visiting the site. None of
them are secrets in the traditional sense (no server-side private keys,
no API keys the frontend needs to protect) because it never signs
anything itself — the connected wallet does. The one entry worth a
second look is `NEXT_PUBLIC_REOWN_PROJECT_ID`, covered below.

| Variable | Purpose | Production value |
|---|---|---|
| `NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS` | The deployed contract address | `0x4b8b06e93aD3e06F29a4491844904743B6d9a0b2` |
| `NEXT_PUBLIC_GENLAYER_NETWORK` | Which GenLayer chain to target | `studionet` |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | RPC endpoint for direct contract reads/writes | `https://studio.genlayer.com/api` |
| `NEXT_PUBLIC_API_URL` | Backend indexer/API base URL | `https://proofbounty-api.fly.dev` |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown (WalletConnect) project ID — powers the multi-wallet connect modal (`lib/reown-config.ts`) | `00a166f22ba09aef8f71d5c707ba0cdc` |

**On `NEXT_PUBLIC_REOWN_PROJECT_ID`**: a Reown project ID is a public
identifier, not a secret — it scopes usage/analytics on Reown's Cloud
dashboard and is meant to be embedded in client-side code (every dApp
using WalletConnect ships one in its bundle the same way). It grants no
access to funds, wallets, or the contract; it cannot be used to sign
anything or impersonate the app. Still tracked here rather than treated
as a throwaway value because rotating it means updating both this env var
and the `metadata.url`/`metadata.icons` fields in `lib/reown-config.ts`
to keep matching what's registered on Reown Cloud, or wallet apps may
show an "unverified app" warning during connect.

Local dev: copy `apps/web/.env.example` to `apps/web/.env.local` (already
done in this repo, pointing at production values by default).

## `apps/api` (Fastify backend)

| Variable | Purpose | Secret? | Production value / source |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection string | Yes | Auto-set by `fly postgres attach` |
| `PORT` | HTTP listen port | No | `8080` |
| `PROOFBOUNTY_CONTRACT_ADDRESS` | Contract to index | No (but treated as a secret via `fly secrets` for convenience — no harm either way) | `0x4b8b06e93aD3e06F29a4491844904743B6d9a0b2` |
| `GENLAYER_RPC_URL` | GenLayer RPC endpoint the indexer reads from | No | `https://studio.genlayer.com/api` |
| `INDEXER_POLL_INTERVAL_MS` | How often the indexer polls the contract | No | `20000` |
| `CORS_ORIGIN` | Allowed frontend origin | No | `https://proof-bounty.vercel.app` |
| `NODE_ENV` | `development` \| `production` \| `test` | No | `production` |
| `REDIS_URL` | Upstash Redis, paces outbound GenLayer RPC calls to both the per-minute and per-hour caps | **Yes** | Set via `fly secrets set`, never committed |
| `GENLAYER_RPC_RATE_LIMIT_PER_MINUTE` | The per-minute RPC budget the rate limiter paces against | No | `30` |
| `GENLAYER_RPC_RATE_LIMIT_PER_HOUR` | The per-hour RPC budget — StudioNet enforces a separate, stricter 500/hour cap discovered live in production; this defaults to `480` as a safety margin under it | No | `480` |
| `GENLAYER_RPC_RATE_LIMIT_PER_DAY` | The per-day RPC budget — StudioNet also enforces a 5,000/day cap, discovered live the same way as the hourly one; this defaults to `4800` as a safety margin under it | No | `4800` |

`REDIS_URL` is the one genuinely sensitive value here (it's a live
credential with write access to a shared Redis instance). It is:
- **never** in `.env.example` (only a placeholder pattern is shown there)
- in `.env` locally, which is gitignored (`apps/api/.gitignore` was
  created before anything else touched this repo, specifically to prevent
  this)
- set as a **Fly secret** in production (`fly secrets set REDIS_URL=...`),
  never in `fly.toml`'s plaintext `[env]` block

Local dev: `cp apps/api/.env.example apps/api/.env`, then fill in your own
`REDIS_URL` (a free Upstash Redis instance works fine) and adjust
`DATABASE_URL` if you're not using the provided `docker-compose.yml`.

## Validation

Both apps validate their environment at startup and fail fast with a
clear error if something required is missing:
- Frontend: `lib/contract-config.ts` — `isContractConfigured()` gates
  every page that needs the contract address, rendering an explicit
  "not configured" state instead of a silent failure.
- Backend: `src/lib/env.ts` — a `zod` schema (`envSchema.parse(process.env)`)
  throws immediately on boot if a required variable is missing or
  malformed, rather than failing confusingly later at first use.
