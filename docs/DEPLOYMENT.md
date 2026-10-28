# Production deployment

## Current production

| Component | Value |
|---|---|
| GenLayer StudioNet | `0x89322f6fc61872B812E4BE9E647F2154B7f73BE1` |
| Base Sepolia escrow | `0xEA3Ee1bD267C343c6C8e7C8C24bcfd401836dC83` |
| Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Frontend | <https://proof-bounty.vercel.app> |
| Fly app | `proofbounty-usdc-api` |
| API | <https://proofbounty-usdc-api.fly.dev> |
| Postgres | `proofbounty-usdc-db` |

Live service roles:

| Role | Address |
|---|---|
| Base owner and treasury | `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb` |
| Base relayer | `0x80f75Ac534d43f9e17941Ab95c14B67c57c8878e` |
| Base decision signer | `0xDd2F40c795039Fa3fDBC812D27BDb34acf52f907` |
| GenLayer funding attestor | `0x62c053704985903BF36129c999Fe6DBCBD9D06B7` |

## Deployment order

1. Run all checks in [VERIFICATION.md](VERIFICATION.md).
2. Deploy `contracts/proof_bounty.py` to StudioNet using constructor arguments
   `treasury` and `default_fee_bps`.
3. Set `funding_attestor` with `update_funding_attestor`.
4. Deploy `ProofBountyEscrow` on Base Sepolia with USDC, relayer, decision
   signer, and treasury constructor values.
5. Verify the live Base getters and fund the relayer with Base Sepolia ETH.
6. Set Fly configuration and encrypted secrets.
7. Deploy the API and require passing `/livez` and `/health` responses.
8. Set Vercel public environment variables and deploy the frontend.
9. Compare `genlayer code <address>` with the repository source and record all
   addresses and transaction hashes in [VERIFICATION.md](VERIFICATION.md).

## API deployment

Non-secret values live in `apps/api/fly.toml`. Production secrets are:

- `DATABASE_URL`
- `BASE_RELAYER_PRIVATE_KEY`
- `BASE_DECISION_SIGNER_PRIVATE_KEY`
- `GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY`
- `REDIS_URL`, when Redis pacing is enabled

Set secrets without printing values into logs:

```bash
fly secrets set NAME=value -a proofbounty-usdc-api
fly deploy --remote-only -a proofbounty-usdc-api
curl -fsS https://proofbounty-usdc-api.fly.dev/livez
curl -fsS https://proofbounty-usdc-api.fly.dev/health
```

Use distinct keys for relay transactions, EIP-712 decision authorization, and
GenLayer funding attestation. The relayer needs Base Sepolia ETH. The decision
signer does not submit transactions. The attestor signs StudioNet writes.

## Frontend deployment

Set the public variables from [ENVIRONMENT.md](ENVIRONMENT.md), then:

```bash
cd apps/web
npm ci
npm run lint
npx tsc --noEmit
npm run build
vercel --prod --yes
```

Confirm the canonical alias remains `https://proof-bounty.vercel.app` and that
the settings page displays the current GenLayer and Base addresses.

## Rotation and redeployment

- Base owner can rotate relayer, decision signer, treasury, and ownership.
- GenLayer owner can rotate the funding attestor.
- A new GenLayer deployment starts a new bounty ID namespace. Deploy a fresh
  Base escrow or otherwise ensure old Base bounty IDs cannot be registered to
  the new contract.
- Update API and frontend addresses atomically, clear stale indexed data, and
  leave old applications disabled.
- Do not reuse temporary deployment keys or commit key material. Remove local
  temporary copies after encrypted production secrets are installed.

## Current operational limitation

GitHub Actions refuses to start runners because the repository owner's account
is billing-locked. Restore billing and rerun the latest workflow. This is an
account condition; no job steps currently execute.
