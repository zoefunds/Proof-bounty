# Contributing

## Required checks

Contract and escrow:

```bash
genvm-lint lint contracts/proof_bounty.py --json
gltest tests/integration -v -s -k "is_a_safe_noop or human_override"
forge test -vv
```

Applications:

```bash
(cd apps/api && npm ci && npm test && npx tsc --noEmit && npx prisma generate && npm run build)
(cd apps/web && npm ci && npm run lint && npx tsc --noEmit && npm run build)
```

Some local environments prevent the Next.js Turbopack worker from binding a
local port. `npx next build --webpack` is an acceptable local fallback, but the
Vercel Turbopack production build remains the deployment gate.

## Contract changes

- GenLayer must remain non-payable. Economic values are declared six-decimal
  USDC terms; tokens never move through GenLayer.
- Never create a capped attempt before verified Base funding. Pending demand
  belongs in `AttemptReservation` storage.
- Preserve permissionless reservation expiry and signature-free Base recovery.
- Any Base escrow change needs focused Foundry coverage for caller identity,
  EIP-712 field binding, replay/conflict behavior, conservation, and recovery.
- After GenLayer deployment, compare `genlayer code <address>` with the local
  source before changing production configuration.

## Frontend changes

- Read finalized GenLayer state directly for payment-critical actions.
- Never derive a new attempt index from a preflight `attempt_count`; reconcile
  the finalized reservation and its `activated_attempt_index`.
- Persist Base funding recovery state before requesting cross-chain binding.
- Keep adjudication records visually distinct from funded Base positions.
- Route GenLayer writes through `lib/use-contract-write.ts` for consistent
  transaction lifecycle handling.

## Backend changes

- Postgres is discovery/cache only. Registration, funding authorization,
  binding, and settlement must use fresh direct reads.
- Normal GenLayer reads go through `readContract()` for timeout and Redis rate
  limiting. The funding attestor is the only narrow backend write authority.
- Keep relay, decision-signer, and funding-attestor keys distinct.
- Prisma schema changes require a migration; do not use `db push` for changes
  intended for production.
- Never log signatures, keys, database URLs, or Redis credentials.

## Documentation

When addresses, roles, applications, trust assumptions, test counts, or
deployment commands change, update README, milestone, architecture, security,
deployment, environment, verification, and project memory in the same commit.
Retired addresses belong in Git history, not current operations documents.
