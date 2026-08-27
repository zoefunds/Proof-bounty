# Contributing

## Project structure

This is a monorepo with three independently-deployable pieces:

- `contracts/` — the Intelligent Contract (Python, GenVM)
- `apps/web/` — Next.js frontend
- `apps/api/` — Fastify backend/indexer

There is no shared build tooling across them (no Turborepo/Nx) — each has
its own `package.json` and is deployed independently. Keep it that way
unless the coordination overhead of a monorepo tool actually earns its
keep.

## Contract changes

1. Edit `contracts/proof_bounty.py`.
2. `genvm-lint check contracts/proof_bounty.py --json` — must show
   `"ok": true` for both `lint` and `validate`. This is what catches
   schema-loading regressions before they ever reach a deployment.
3. Run the integration suite. **This repo has no `gltest.config.yaml`**,
   so the network must always be passed explicitly or the CLI silently
   defaults to `localnet` (which isn't configured/running here):
   ```bash
   gltest tests/integration -v -s -m "not llm" --network studionet --chain-type studionet
   ```
   Tests marked `@pytest.mark.llm` need real web fetch + live LLM
   consensus, are slower, and aren't assertion-stable run to run — include
   them (drop `-m "not llm"`) only when you specifically want to exercise
   that path. One test uses `gltest.direct` (a native, offline Python
   runner with Foundry-style cheatcodes — `direct_vm`/`direct_deploy`/
   `direct_accounts` fixtures) instead of live StudioNet, for a scenario
   that needs to advance past a real-time window (a 2-day appeal window)
   that isn't practical to wait out live — see that test's docstring in
   `test_proof_bounty.py` for the exact pattern (patching
   `gl.message_raw["datetime"]` directly, since `VMContext.warp()` alone
   does not reach this contract's `_now()`; verify any such cheatcode
   assumption empirically with a throwaway probe before relying on it,
   the same discipline this project applies to every other unverified
   GenVM API assumption).
4. Redeploy manually via GenLayer Studio/CLI (contracts are never
   deployed by an agent in this project — see `memory/MEMORY.md`).
5. Update the address everywhere it's configured (see
   `docs/DEPLOYMENT.md`'s redeploy checklist) and clear the cached
   database of the retired contract's data before running any new tests
   against the fresh one — stale cross-contract bounty ids in the cache
   or in test assumptions are a real, previously-hit failure mode.

## Frontend changes

```bash
cd apps/web
npm run dev            # local dev server
npx tsc --noEmit        # type-check
npm run build            # full production build (also type-checks)
```

Design tokens live in `app/globals.css` as Tailwind v4 `@theme` variables,
translated 1:1 from the original `DESIGN.md` prototype — don't hardcode
hex colors in components; use the token classes (`bg-action-green`,
`text-on-surface-variant`, etc.).

Every write action must go through `lib/use-contract-write.ts`, never a
raw `client.writeContract` call — this is what guarantees the full
transaction-lifecycle UI (wallet request → awaiting signature → submitted
→ pending → confirmed, plus every failure state) shows up consistently.

## Backend changes

```bash
cd apps/api
docker compose up -d          # local Postgres
npx prisma migrate dev --name <description>   # after schema.prisma changes
npm run dev                    # local server with the indexer running
npx tsc --noEmit                # type-check
```

If you change `prisma/schema.prisma`, always generate a migration with
`prisma migrate dev` (not `db push`) so the migration ships to production
via `prisma migrate deploy` on the next `fly deploy` (see the Dockerfile's
`CMD`).

Any new outbound call to GenLayer must go through `readContract()` in
`src/lib/genlayer.ts` — never call `genlayer-js` directly — so it stays
subject to the Redis rate limiter.

## Code style

- No comments explaining *what* code does — names should already say
  that. Comments are for *why*: a non-obvious constraint, a workaround for
  a specific confirmed bug, a design decision someone would otherwise
  "simplify" back into the bug it fixes.
- Prefer explicit, narrow types over `any`. The one place `unknown`/`as`
  casts are expected is at the GenLayer SDK boundary (its `CalldataEncodable`
  return type doesn't know the contract's actual return shape).
- Match the escrow-safety discipline in the contract if you ever touch
  payout logic: read the ledger, zero it, persist, *then* transfer — never
  the other order.

## Testing philosophy

- Contract: `genvm-lint` on every change (fast, catches schema issues),
  `gltest` integration tests for behavior (31 total — 30 deterministic
  against real StudioNet or the offline `gltest.direct` runner, 1
  dependent on live LLM output and marked `@pytest.mark.llm`).
- Frontend/backend: `tsc --noEmit` is the fast gate; a real build
  (`npm run build`) is the one that actually matches what gets deployed —
  run it before deploying, not just the type-checker.
- **Trust the live network over a claim of "fixed" or "tested."** This
  project has more than once had a fix described as shipped/verified that
  turned out not to actually be present in the deployed bytecode, or a
  test suite described as passing that turned out to be silently broken
  at fixture setup. Before believing either, verify directly: `grep`/`diff`
  the actual source against `genlayer code <address>` for the contract,
  and actually run the test suite (not just read it) for tests.
