# PROOFBOUNTY

> Put money behind a claim. Then let the internet prove whether you earned it.

An onchain marketplace for verifiable public outcomes, built on [GenLayer](https://genlayer.com)
Intelligent Contracts. A bounty creator locks a GEN reward against a
precommitted, immutable set of proof criteria. Any number of challengers may
race to submit evidence for the same bounty. The Intelligent Contract itself
fetches that evidence live from the web and asks GenLayer's validator
consensus to judge only the fetched content against the locked criteria —
never a challenger's own account of what their evidence shows. The first
challenger to receive a valid, favorable verdict wins the reward; every other
concurrent challenger's bond is returned.

**Honest framing:** this is **AI-reviewed, centrally-appealable escrow** —
GenLayer's validator consensus makes the *initial* evaluation of live web
evidence genuinely decentralized and non-custodial, but disputes escalate to
a single per-bounty arbiter (chosen by the bounty's creator, who may
self-arbitrate) and, on appeal, to the protocol owner as the final tier.
That is a real, disclosed trust boundary — not full decentralized
adjudication. A staked, multi-arbiter registry with slashing and conflict
disclosure would move this further toward that; not implemented, and the
contract's own `ARBITER TRUST MODEL` module docstring explains the reasoning
for the current scope.

See [`memory/MEMORY.md`](memory/MEMORY.md) for the full build history, every
architecture decision, and every audit round this project has been through
(read this first if you're picking the project back up after a break).

## Status

| Piece | State |
|---|---|
| Intelligent Contract (`contracts/proof_bounty.py`, 2,107 lines, 32 public methods) | ✅ Deployed live on StudioNet, deployed bytecode confirmed matching source via `genlayer code` |
| Frontend (`apps/web`, Next.js 15 App Router) | ✅ Deployed — [proof-bounty.vercel.app](https://proof-bounty.vercel.app) |
| Backend indexer/API (`apps/api`, Fastify + Postgres) | ✅ Deployed — [proofbounty-api.fly.dev](https://proofbounty-api.fly.dev) |
| Automated test suite (`tests/integration/`, pytest/`gltest`) | ✅ 31 tests — 30 pass deterministically, 1 depends on live LLM output |
| Manual live-chain verification scripts (`scripts/`) | ✅ 9 scripts, all run against live StudioNet with realistic content |
| Notifications | ✅ Built — per-recipient, polling-based (not push/email/webhook) |
| Independent off-chain evidence archive | ✅ Built — real SHA-256, SSRF-hardened, cross-checked against the on-chain fingerprint |
| End-to-end test with a real, unmanaged browser wallet (MetaMask etc.) | ⏳ Not yet run |

**Live contract address:** `0x4b8b06e93aD3e06F29a4491844904743B6d9a0b2` (GenLayer StudioNet, deployed 2026-08-26 — the 4th deployment of this project; see `memory/MEMORY.md` for why the first three were retired)

## How it works

1. **Create a bounty.** A creator locks GEN (`create_bounty`) against a
   title, a claim, a claim polarity (`POSITIVE`/`NEGATIVE` — you can bounty
   either "prove X happened" or "prove X did NOT happen"), a category (one
   of `SECURITY`, `GOVERNANCE`, `OPEN_SOURCE`, `DOCUMENTATION`,
   `PROTOCOL_RESEARCH`, `ONCHAIN_ANALYSIS`, `PRODUCT_CLAIMS`,
   `PUBLIC_ACCOUNTABILITY`, `OTHER`), a precommitted set of proof criteria,
   a description of acceptable evidence, an arbiter address (may be the
   creator themself), a deadline, and an optional required challenger bond.
2. **Any number of challengers accept concurrently.** Each `accept_bounty`
   call locks the bounty's criteria immutably (if not already locked) and
   opens an independent `Attempt`. Up to `MAX_ATTEMPTS_PER_BOUNTY` (40)
   concurrent attempts are allowed per bounty — a deliberate cap that
   bounds the cost of the settlement-time "mark every other attempt
   LOST_RACE" loop, closing a settlement-availability DoS vector.
3. **A challenger submits an evidence URL** (`submit_evidence`) and
   triggers verification (`request_verification`, permissionless — anyone
   can call it once evidence is submitted, so a stalled attempt is never
   stuck waiting on the challenger specifically).
4. **The contract fetches the URL itself**, live, inside GenVM's
   non-deterministic execution (`gl.nondet.web.render(url, mode="text")`),
   and asks an LLM to judge the FETCHED CONTENT — never the challenger's
   own description — against the immutable criteria, using
   `gl.eq_principle.prompt_comparative` so every validator's independent
   fetch-and-judge run must converge to the same verdict for consensus.
5. **One of five verdicts comes back:**
   - `APPROVED` — full reward to this attempt, every other live attempt on
     the bounty flips to `LOST_RACE` (bonds independently reclaimable).
   - `PARTIAL` — a bucketed percentage of the reward (rounded onto a
     discrete 500-basis-point grid *before* being compared for consensus,
     so "close enough" and "identical" collapse into the same value —
     see `PAYOUT_BUCKET_BPS`'s docstring for why this is what makes an
     exact-match equivalence principle safe here).
   - `REJECTED` — the evidence unambiguously fails the criteria; after any
     dispute window, the bond becomes forfeitable to the creator.
   - `NEEDS_REVISION` — a fixable, technical submission problem (dead
     link, empty page, wrong page); the challenger gets another
     resubmission cycle (`max_revisions`, default 3).
   - `INSUFFICIENT_EVIDENCE` — the fetched content is real, readable, and
     on-topic, but doesn't itself confirm or contradict the criteria.
     Distinct in consequence from `REJECTED`: exhausting the resubmission
     cycle on this verdict **refunds** the bond instead of forfeiting it,
     since "the evidence never settled the question" isn't the
     challenger's fault the way a demonstrably-wrong submission is.
6. **Either party may dispute** a verdict before it becomes final
   (`raise_dispute`). The bounty's named arbiter reviews and rules
   (`resolve_dispute`) — but that ruling does **not** move money
   immediately. It opens a 2-day appeal window
   (`ARBITER_RESOLVED_PENDING_APPEAL`).
7. **Either party may appeal** the arbiter's ruling within that window by
   posting a bond equal to the original challenger bond
   (`appeal_arbiter_resolution`), escalating to `APPEALED`. If nobody
   appeals, anyone may permissionlessly finalize the arbiter's ruling once
   the window closes (`finalize_arbiter_resolution`) — actually paying out
   at that point, since only then is there truly nothing left to appeal
   to.
8. **On appeal, the protocol owner makes the final call**
   (`resolve_appeal`) — the contract's second and last resolution tier.
   The appeal bond is returned to whichever side's position the owner's
   ruling actually vindicates (computed automatically from whether the
   final verdict/payout differs from the arbiter's pending one — never a
   separate "uphold/overturn" flag the owner could set inconsistently
   with the real numbers).

Every settlement path — direct AI verdict, arbiter default resolution,
finalized arbiter ruling, or owner appeal ruling — runs through the same
two shared primitives (`_settle_reward_to_winner`, `_forfeit_attempt_bond`,
`_refund_attempt_bond`), each following a strict **read the ledger, zero
it, persist the new status, only then transfer GEN** order, so no code path
can double-pay or leave an attempt in a state where it owes money nobody
can reach.

## Evidence provenance

Two independent, complementary layers, because neither one alone can fully
solve "prove what was actually judged":

- **On-chain evidence manifest.** Every verification run computes a
  64-bit FNV-1a fingerprint (`_content_digest`) of the exact, truncated
  page text every validator fetched and judged, and stores it on the
  `Attempt` (`evidence_content_hash`). It's deliberately *not*
  cryptographically strong — see that function's docstring — because its
  job is fast, deterministic, consensus-safe drift detection, not
  tamper-proofing. It's hand-rolled in pure Python (no `hashlib` import)
  specifically because an earlier version of this contract shipped an
  API call (`gl.get_balance`) that looked standard but didn't exist on the
  pinned GenVM runner — a lesson in never assuming a stdlib import works
  inside GenVM's constrained sandbox without verifying it first.
- **Independent off-chain archive.** The backend indexer detects every
  evidence submission and verification event and, server-side (with zero
  of the contract's sandbox uncertainty), independently re-fetches the
  same URL, computes a real cryptographic SHA-256 over the actual content,
  and stores it in Postgres — `apps/api/src/services/evidence-archiver.ts`.
  This archive also computes its own FNV-1a digest with the exact same
  algorithm as the contract and compares it against the on-chain
  fingerprint, recording whether they match. A mismatch is **expected**
  for markup-heavy pages (the contract's fetch strips HTML down to plain
  text; the archive stores the raw HTTP body) and is not itself evidence
  of tampering — the point is making that gap *observable*, in the UI and
  via the API, rather than silently assumed away. The frontend surfaces
  this directly on every attempt with evidence (`AttemptCard`'s
  "Independent off-chain archive" panel).

**What this does not do:** there is no IPFS/Arweave pinning of evidence
(no decentralized archival infrastructure is configured for this project),
no multi-source evidence corroboration, and no way to literally recover
the exact bytes each individual validator's non-deterministic web fetch
saw (GenVM doesn't expose that). These are documented, intentional scope
boundaries, not oversights — see the contract's `EVIDENCE MANIFEST` module
docstring section.

## Escrow safety

- **Exact-value only.** `create_bounty` and `accept_bounty` both require
  `gl.message.value` to *exactly* equal the amount being escrowed — never
  "at least." No overpayment is ever silently absorbed.
- **Zero-then-transfer, everywhere.** Every function that pays out GEN
  reads the relevant ledger field, zeroes it and persists the new status
  in storage, and only *then* calls `_send_gen`. This ordering means a
  reentrant or failed transfer can never leave the contract able to pay
  the same bond or reward twice.
- **Zero-bond bounties are first-class.** A bounty's `required_bond` may
  legitimately be `0`. Every terminal-state transition (`_refund_attempt_bond`,
  `_forfeit_attempt_bond`, `reclaim_bond_after_settlement`) is written to
  reach its terminal status *regardless* of whether there's actually a
  nonzero balance to transfer — an earlier version of this contract
  unconditionally reverted on a zero balance, which meant a zero-bond
  attempt's STATE (never funds, since none were owed) could get stranded
  forever with no way to reach LOST_RACE/BOND_FORFEITED.
- **The settlement-loop DoS fix.** `_mark_other_attempts_lost_race` runs
  once, every time a bounty settles, over every attempt that bounty has
  ever accumulated. `MAX_ATTEMPTS_PER_BOUNTY = 40` bounds that loop's cost
  so it can never grow large enough to make the *winning* challenger's own
  settlement transaction exceed practical execution limits — see that
  constant's docstring for the full reasoning.

## Repo layout

```
contracts/                The single production Intelligent Contract (proof_bounty.py)
tests/integration/        pytest/gltest integration tests — 30 deterministic + 1 LLM-dependent
scripts/                  Manual live-StudioNet verification scripts (01-09), realistic content
apps/web/                 Next.js frontend (deployed to Vercel)
apps/api/                 Backend indexer + REST API + evidence archiver (deployed to Fly.io)
memory/MEMORY.md          Persistent cross-session project memory — read first
docs/                     ARCHITECTURE.md, SECURITY.md, DEPLOYMENT.md, ENVIRONMENT.md, CONTRIBUTING.md
```

## Quickstart

### Contract

```bash
cd contracts
genvm-lint check proof_bounty.py --json      # lint + schema validation (32 methods, 19 write / 13 view)
genvm-lint schema proof_bounty.py             # print the full ABI
```

Deployment target is GenLayer Studio / StudioNet. **The contract is deployed
manually by the project owner, never by an agent or automated tooling** —
see `memory/MEMORY.md`'s standing rule and deployment-state table.

### Running the test suite

```bash
cd tests/integration  # or run from repo root with the path below
gltest tests/integration -v -s -m "not llm" --network studionet --chain-type studionet
```

This runs all 30 deterministic tests for real against live StudioNet
(no `gltest.config.yaml` exists in this repo, so the network must be passed
explicitly or the CLI silently defaults to `localnet`). One test
(`test_zero_bond_reclaim_after_settlement_is_a_safe_noop`) uses
`gltest.direct`'s native, offline Python test runner with a time-warp
cheatcode instead of live StudioNet, since it needs to advance past a
2-day appeal window — not practical to wait out against a real network.
Drop `-m "not llm"` to include `test_request_verification_full_lifecycle`,
which depends on live, non-deterministic LLM output and isn't
assertion-stable run to run.

### Frontend

```bash
cd apps/web
npm install
npm run dev          # http://localhost:3000
```

### Backend

```bash
cd apps/api
cp .env.example .env  # fill in DATABASE_URL, GENLAYER_RPC_URL, etc — see docs/ENVIRONMENT.md
docker compose up -d   # local Postgres on :5443
npx prisma migrate dev
npm run dev            # http://localhost:8080
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, data flow, why each piece exists
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, escrow safety, SSRF/evidence handling, rate limiting
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — how everything got deployed and how to redeploy
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — every environment variable, what it does, where it's set
- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) — local dev workflow, testing, code style
- [`memory/MEMORY.md`](memory/MEMORY.md) — full build history, every architecture decision, every audit round
