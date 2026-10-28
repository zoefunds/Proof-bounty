# Production end-to-end test record

Executed sequentially on 2026-10-28 against the current StudioNet, Base
Sepolia, Fly, and Vercel deployments. No mock claims or placeholder text were
used. The test data consists of two real public-documentation claims:

1. Bounty 0 asks whether GenLayer's official documentation describes
   Intelligent Contracts as AI-powered smart contracts with LLM or web-access
   capabilities. It has a 5 USDC reward and 1 USDC required bond.
2. Bounty 1 asks whether Base's official documentation describes Base as a
   secure, low-cost, builder-friendly Ethereum L2. It has a 7 USDC reward and
   1.5 USDC required bond.

Both GenLayer records are finalized, both Base reward deposits are funded and
registered, and the production index contains exactly those two records.

## Route matrix

Every application section received two sequential production checks.

| Section | Test 1 | Test 2 | Result |
|---|---|---|---|
| Home `/` | Render the GenLayer-to-Base lifecycle and adjudication disclosure | Render both live cards with exact 5/7 USDC rewards and 1/1.5 USDC bonds | Pass |
| Explore `/explore` | Load the live index and report exactly 2 bounties | Exercise category filtering and its deterministic result/empty state | Pass |
| Create `/create` | Route renders without an application error | Disconnected state blocks writes and explains both GenLayer creation and Base funding | Pass |
| Dashboard `/dashboard` | Route renders without an application error | Disconnected state explains that reputation and escrow data are wallet-bound | Pass |
| My attempts `/my-attempts` | Route renders without an application error | Disconnected state prevents identity-dependent history from being misattributed | Pass |
| Disputes `/disputes` | Render the dispute queue section | Render the correct empty state without inventing a dispute | Pass |
| Settings `/settings` | Display the new StudioNet and Base escrow addresses | Display Base Sepolia USDC and the production StudioNet RPC | Pass |
| Bounty detail `/bounty/[id]` | Bounty 0 renders its exact claim, immutable criteria, deadline, reward, and bond | Bounty 1 renders its distinct claim, criteria, deadline, reward, and bond | Pass |
| Profile `/profile/[address]` | Resolve the real creator address | Report 2 bounties created and 12 USDC funded from indexed chain state | Pass |

## Backend and cross-chain checks

Two production API reads were run after the route matrix:

1. `GET /bounties?sort=reward-desc&limit=2` returned bounty 1 before bounty 0,
   with exact six-decimal amounts and `total: 2`.
2. `GET /bounties?category=DOCUMENTATION&q=GenLayer&limit=10` returned only
   bounty 0 with `total: 1`.

`GET /health` returned `status: ok`, `lastBountyCount: 2`,
`cachedBounties: 2`, and `lastError: null`. Direct Base reads confirmed both
positions have the correct creator and terms and are registered. The Base
funding transactions are recorded in [VERIFICATION.md](VERIFICATION.md).

## Sequential repository verification

The checks were deliberately run one after another:

1. `forge test -vv`: 16 passed, 0 failed.
2. `npm test` in `apps/api`: 12 passed, 0 failed.
3. `npm run build` in `apps/api`: TypeScript and Prisma generation passed.
4. `npm run lint` in `apps/web`: passed.
5. `npx tsc --noEmit` in `apps/web`: passed.
6. `npx next build --webpack` in `apps/web`: all 10 routes built successfully.
7. `gltest ... -k "is_a_safe_noop or human_override"`: 6 passed, 0 failed.
8. `genvm-lint lint contracts/proof_bounty.py --json`: 3 safety checks passed.

The default local Turbopack build attempted to bind a worker port prohibited by
the managed execution sandbox. The webpack production build passed, and the
same source also completed a real Vercel production build. This is an
environment restriction, not a source failure.
