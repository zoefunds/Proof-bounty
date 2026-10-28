# Environment variables

## Frontend (`apps/web`)

All frontend variables are public and bundled into browser JavaScript.

| Variable | Production value / purpose |
|---|---|
| `NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS` | `0x7942320C375529B8fB2E53F4e5a4d901a1c5cB94` |
| `NEXT_PUBLIC_BASE_ESCROW_ADDRESS` | `0x71A6C9f3eA9026009b51463013743e4781F327c9` |
| `NEXT_PUBLIC_BASE_USDC_ADDRESS` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `NEXT_PUBLIC_GENLAYER_NETWORK` | `studionet` |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
| `NEXT_PUBLIC_API_URL` | `https://proofbounty-usdc-api.fly.dev` |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Public Reown project identifier |
| `NEXT_PUBLIC_DEFAULT_FEE_BPS` | Default displayed/created fee, currently `250` |

The Reown project ID is intentionally public but should still match the
registered production domain metadata.

## API (`apps/api`)

| Variable | Required | Secret | Purpose / production value |
|---|---:|---:|---|
| `DATABASE_URL` | yes | yes | Fly Postgres connection |
| `PORT` | yes | no | `8080` |
| `NODE_ENV` | yes | no | `production` |
| `PROOFBOUNTY_CONTRACT_ADDRESS` | yes | no | Current GenLayer contract |
| `GENLAYER_RPC_URL` | yes | no | `https://studio.genlayer.com/api` |
| `CORS_ORIGIN` | yes | no | `https://proof-bounty.vercel.app` |
| `INDEXER_POLL_INTERVAL_MS` | no | no | `20000` in production |
| `REDIS_URL` | no | yes | Shared GenLayer RPC pacing store |
| `GENLAYER_RPC_RATE_LIMIT_PER_MINUTE` | no | no | `30` |
| `GENLAYER_RPC_RATE_LIMIT_PER_HOUR` | no | no | `480` |
| `GENLAYER_RPC_RATE_LIMIT_PER_DAY` | no | no | `4800` |
| `BASE_SEPOLIA_RPC_URL` | no | no | `https://sepolia.base.org` |
| `BASE_ESCROW_ADDRESS` | no | no | Current Base escrow |
| `BASE_RELAY_INTERVAL_MS` | no | no | `120000` |
| `BASE_RELAYER_PRIVATE_KEY` | for relay | yes | Sends Base transactions |
| `BASE_DECISION_SIGNER_PRIVATE_KEY` | for relay | yes | Signs EIP-712 authorizations |
| `GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY` | for funding | yes | Activates verified reservations |

The three service private keys must be distinct. Empty relay-related values may
be used for a read-only local indexer, but production cross-chain funding and
settlement require all three.

## Storage rules

- Commit placeholders only in `.env.example`.
- Keep local `.env` and `.env.local` files ignored.
- Store production private values with `fly secrets set`; never put them in
  `fly.toml`.
- Public addresses and intervals belong in `fly.toml` or Vercel environment
  configuration.
- Rotate any value that appears in logs or chat, even on testnet.

Both applications validate required configuration at startup. Frontend
contract configuration is checked in `lib/contract-config.ts`; API validation
is in `src/lib/env.ts`.
