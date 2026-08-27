# Architecture

## System overview

```
                    ┌──────────────────────┐
                    │   Vercel (Next.js)    │   apps/web
                    │  proof-bounty.vercel  │
                    │        .app           │
                    └──────────┬────────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │                           │
                 ▼                           ▼
     ┌───────────────────────┐   ┌────────────────────────┐
     │  GenLayer StudioNet    │   │  Fly.io (Fastify API)  │   apps/api
     │  ProofBounty contract  │◄──┤  proofbounty-api.fly.dev│
     │  (source of truth)     │   │  polls contract, caches │
     └───────────┬─────────────┘   │  to Postgres,            │
                 │                 │  independently archives  │
                 │ wallet-signed   │  evidence, generates      │
                 │ writes          │  per-recipient            │
                 │                 │  notifications            │
                 ▼                 └───────────┬──────────────┘
        User's injected                        │
        EVM wallet                             ▼
        (MetaMask-compatible)     ┌────────────────────────┐
                                   │  Fly Postgres           │
                                   │  proofbounty-db          │
                                   │  (cache, never source    │
                                   │   of truth)               │
                                   └────────────────────────┘
                                               ▲
                                               │
                                   ┌────────────────────────┐
                                   │  Upstash Redis          │
                                   │  paces GenLayer RPC     │
                                   │  calls: 30/min, 480/hr, │
                                   │  4800/day (all under    │
                                   │  StudioNet's real caps) │
                                   └────────────────────────┘
```

## Why this shape

**The contract is the only source of truth for money.** Every write —
creating a bounty, accepting one, submitting evidence, requesting
verification, disputing, resolving, appealing, admin actions — happens as a
wallet-signed transaction sent directly from the frontend to the contract.
The backend never signs or submits transactions; it only ever calls the
contract's `@gl.public.view` methods, plus one independent, best-effort
side-channel (see "Evidence archival" below) that never touches the
contract or moves money.

**The backend exists because GenVM contracts have no event log.** Unlike
Solidity, there's no way to subscribe to "a bounty was created" or "an
attempt was accepted." The only way to know what changed is to read the
contract's current state and compare it to what you read last time. So
`apps/api`'s indexer (`src/services/indexer.ts`) polls `list_bounties` /
`get_bounty_attempts` / `get_reputation` on an interval, diffs against
what's cached in Postgres, reconstructs an activity feed and per-recipient
notifications from those diffs, and triggers independent evidence
archival when it detects a new evidence submission or verification result.
This turns marketplace search/filter and "my activity" lookups from an
O(bounties) client-side scan into a fast indexed query — but the cache can
lag the contract by up to `INDEXER_POLL_INTERVAL_MS` (or considerably more
if GenLayer's real RPC rate limits are currently exhausted — see below),
and nothing in the frontend treats it as authoritative for anything
payment-critical (see `lib/use-my-activity.ts`'s fallback-to-direct-scan
behavior).

**Cost-saving optimization.** Once every attempt on a cached bounty is
already in a terminal state (`WON`, `LOST_RACE`, `BOND_FORFEITED`,
`CANCELLED`, `INSUFFICIENT_EVIDENCE_FINAL`), the indexer skips re-polling
that bounty's attempts on subsequent passes — bounty-level terminality
alone isn't a safe skip condition, since a bounty can be `SETTLED` via one
attempt while a *different* attempt on the same bounty is still live and
disputable, so the check is attempt-level.

**Why a three-tier rate limiter sits between the backend and GenLayer.**
GenLayer's real StudioNet RPC limits were discovered empirically, in
sequence, across this project's development: 30 requests/minute, 500/hour,
and 5,000/day. A naive poll loop blows past the per-minute cap almost
immediately once there are more than a handful of bounties, and even a
correctly-paced per-minute loop can still exhaust the hourly or daily
ceiling under sustained load. `apps/api/src/lib/rate-limiter.ts` uses a
generic Redis Lua-script fixed-window counter (`throttleFixedWindow`),
instantiated once per window (minute/hour/day, each with margin under the
real limit — 480/hr and 4,800/day) and checked in sequence
(day → hour → minute) before every outbound GenLayer call. This is correct
no matter how many API/indexer processes end up sharing the budget — a
Fly machine restart or a future scale-up shouldn't silently double the
effective RPC rate. **This limiter only paces the backend's own calls** —
it cannot pace or protect against a separate process (a test script,
another deployed app, a different session) drawing on the same underlying
per-account/per-endpoint daily quota; exhausting that quota surfaces as
`/health` going `degraded` with a `Rate limit exceeded` error, which is
real infrastructure behavior, not a bug, and the indexer recovers on its
own once the window resets.

**Why the frontend still reads the contract directly for critical paths.**
The bounty detail page (`/bounty/[id]`) — where a user is about to lock a
bond or check exact escrow amounts before signing — reads straight from
the contract via `lib/use-contract-read.ts`, not the backend cache. The
backend is a convenience layer for discovery (search, filters, "my
activity", activity feeds, notifications, evidence archive display),
never a dependency for anything that moves money.

## Contract design

See the module docstring at the top of `contracts/proof_bounty.py` for the
full rationale (escrow safety pattern, consensus-binding for PARTIAL
verdicts, dispute/arbiter-grace recovery paths, the two-tier appeal design,
why this needed GenLayer specifically rather than an off-chain LLM
product). The short version:

- **Multi-attempt marketplace.** Any number of challengers (up to
  `MAX_ATTEMPTS_PER_BOUNTY = 40`) can hold concurrent open attempts on one
  bounty. First valid verdict (`APPROVED` or `PARTIAL`) wins the reward;
  every other still-open attempt is marked `LOST_RACE` and its bond
  becomes independently reclaimable — not treated as a failure.
- **Evidence is always fetched live by the contract itself**
  (`gl.nondet.web.render(url, mode="text")`) and judged by GenLayer's
  validator consensus (`gl.eq_principle.prompt_comparative`) against
  criteria that are locked immutable the moment the first attempt is
  accepted (`criteria_locked`).
- **Five possible verdicts**, not a binary approve/reject — see the
  top-level README's "How it works" section for what each one means and
  why `INSUFFICIENT_EVIDENCE` is a distinct outcome from both `REJECTED`
  and `NEEDS_REVISION`.
- **Two-tier, appealable dispute resolution.** `resolve_dispute` (the
  named arbiter's ruling) never moves money immediately — it opens an
  appeal window. `finalize_arbiter_resolution` executes the ruling only
  once that window has closed unappealed. `appeal_arbiter_resolution` +
  `resolve_appeal` (protocol-owner-only) form the second and final tier.
  This is what makes "appealable" structurally real: once GEN has actually
  left the contract there is nothing left to appeal *to*.
- **Escrow safety**: every payout path reads the ledger, zeros it, persists
  state, and only then transfers value — structurally immune to
  double-spend regardless of call ordering, and correct even for
  zero-bond bounties (a legitimate configuration, not an edge case to
  special-case away).
- **On-chain evidence manifest**: a fast, deterministic FNV-1a fingerprint
  of the exact fetched-and-judged content, exempted from the equivalence
  principle's exact-match comparison (since independent live fetches of a
  mutable web page aren't guaranteed byte-identical) but recorded for
  provenance and cross-checked against the backend's independent archive.

## Frontend structure

- `app/` — Next.js App Router pages: bounty listing/search, bounty detail
  (`/bounty/[id]`), create-bounty flow, my-activity, notifications.
- `lib/wallet-context.tsx` — wallet connection (SIWE-style signed-nonce
  challenge, injected EVM wallet — the connected wallet is the same one
  the contract pays out to; no custody/export/encryption concerns).
- `lib/use-contract-write.ts` — the full transaction lifecycle state
  machine (IDLE → ... → CONFIRMED, plus every failure state) every write
  action goes through.
- `lib/use-contract-read.ts` — direct contract reads for payment-critical
  data.
- `lib/use-my-activity.ts` / `lib/api-client.ts` — backend-cache reads
  (bounties, attempts, activity, reputation, notifications, evidence
  archives) with automatic fallback to direct contract scanning.
- `lib/use-now.ts` — a `useState`+`useEffect`+`setInterval` hook providing
  the current time to components that need it for countdown/deadline
  display, so no component calls `Date.now()` directly during render
  (React's `react-hooks/purity` lint rule forbids that).
- `components/bounty/AttemptCard.tsx` — the full attempt lifecycle UI:
  evidence submission, verification trigger, dispute, the two-tier appeal
  flow (appeal button, countdown, `ResolveAppealForm` for the owner-gated
  final call), the evidence manifest hash display, and the independent
  off-chain archive's hash-match indicator.
- `components/layout/NotificationBell.tsx` — polling notification bell
  (25s interval), reads the backend's per-recipient `Notification` table.

## Backend structure

- `src/services/indexer.ts` — the poll loop: fetch every open/recently-
  changed bounty and its attempts, diff against the cache, upsert, log
  activity events, generate notifications, and trigger evidence archival
  on relevant status transitions.
- `src/services/evidence-archiver.ts` — independent, SSRF-hardened,
  DNS-rebind-safe re-fetch of evidence URLs, real SHA-256 hashing via
  Node's `crypto` module, and an FNV-1a cross-check against the on-chain
  fingerprint. See `docs/SECURITY.md` for the full threat model.
- `src/routes/` — REST endpoints over the cache: `bounties`, `attempts`,
  `activity`, `reputation`, `notifications`, `evidence` (the archive
  list/detail endpoints).
- `src/lib/genlayer.ts` — read-only GenLayer client.
- `src/lib/rate-limiter.ts` — the three-tier Redis-backed RPC pacer
  (minute/hour/day).
- `src/lib/env.ts` — typed, validated environment configuration (Zod).
- `prisma/schema.prisma` — cache schema; see its header comment for the
  "never authoritative" invariant. Notable models: `Bounty`, `Attempt`
  (mirrors every contract-side field including the appeal/evidence-manifest
  additions), `Reputation`, `ActivityEvent`, `Notification`,
  `EvidenceArchive`, `IndexerState`.

## Testing structure

- `tests/integration/test_proof_bounty.py` — 31 `gltest`/pytest tests.
  30 run deterministically (23 original coverage + 8 added across this
  project's audit rounds for the settlement-DoS cap, zero-bond terminal
  transitions, and the full appeal state machine); 1
  (`test_request_verification_full_lifecycle`) depends on live,
  non-deterministic LLM output and is marked `@pytest.mark.llm` so it can
  be excluded from routine runs. One test
  (`test_zero_bond_reclaim_after_settlement_is_a_safe_noop`) uses
  `gltest.direct` — a native, offline Python contract runner with
  Foundry-style cheatcodes (`prank`, `deal`, time control via directly
  patching `gl.message_raw["datetime"]`, since this contract's `_now()`
  reads that field directly rather than `datetime.now()`) — to
  deterministically advance past a 2-day appeal window and reach a state
  no live-network test can practically wait out.
- `scripts/01`–`09` (`.mjs`) — manual, live-StudioNet verification
  scripts using `genlayer-js` directly, with realistic, detailed bounty
  content (not placeholder text), covering the full lifecycle end to end:
  initial state, validation failures, the happy-path multi-challenger
  race, the rejected path, remaining write methods, dispute flow,
  reputation, the 40-attempt cap + zero-bond terminal transitions, and
  the full two-tier appeal flow through the owner-gated boundary.
