# Architecture

## Components and authority

```text
Browser wallet
  ├─ GenLayer StudioNet ─ ProofBounty adjudication state
  └─ Base Sepolia ────── ProofBountyEscrow USDC custody
             ▲                    ▲
             │                    │
Next.js frontend          Fastify API / relay / attestor
                                  │
                         Postgres cache + Redis RPC pacing
```

- `contracts/proof_bounty.py` is the adjudication source of truth. It stores
  claims, criteria, reservations, attempts, evidence, verdicts, disputes, and
  final adjudication status. All entrypoints are non-payable.
- `contracts/base/ProofBountyEscrow.sol` is the monetary source of truth. It
  holds Base Sepolia USDC, binds funded positions to GenLayer identities, and
  allocates claimable balances.
- `apps/web` reads finalized state directly for funding-critical operations.
  The connected wallet signs both GenLayer and Base user transactions.
- `apps/api` has three roles: read/index GenLayer into Postgres, attest Base
  funding on GenLayer after receipt reconciliation, and relay authorized Base
  registration/binding/settlement transactions.
- Postgres is discovery/cache only. Redis enforces shared outbound GenLayer RPC
  budgets. Neither database is settlement authority.

## Funding state machine

```text
GenLayer reservation (no cap used)
        │ EIP-712 authorization for exact challenger
        ▼
Base pending funding
        │ receipt + event verified
        ▼
GenLayer activated attempt (cap used, criteria lock)
        │ exact final index + Base tx hash
        ▼
Base bound attempt
```

`reserve_attempt` creates a two-hour reservation in storage separate from
adjudication attempts. It cannot exhaust `MAX_ATTEMPTS_PER_BOUNTY`. The API
issues a funding authorization only after directly reading a matching pending
reservation. After Base funding, it verifies the successful receipt, escrow
destination, event bounty/reservation/challenger, and pending Base position.
Only then does the dedicated funding-attestor key call
`confirm_attempt_funding`. The activated index is read back from GenLayer and
bound on Base under a second EIP-712 authorization.

If confirmation fails, the frontend persists the reservation and Base
transaction hash for retry. If service availability is not restored, the
challenger can recover the unbound position after expiry plus 24 hours.

## Adjudication

Up to 40 funded attempts can exist for a bounty. Criteria lock only when the
first funded reservation is activated. Validators retrieve evidence with
`gl.nondet.web.render` and compare structured verdicts with
`gl.eq_principle.prompt_comparative`.

The named arbiter can record an advisory dispute ruling, but cannot settle it.
An explicit appeal or permissionless post-window finalization runs a second
GenLayer consensus round. The final GenLayer state is relayed to Base only
after a fresh direct read.

Positive-bond appeals enter a two-hour `APPEAL_PENDING_FUNDING` reservation.
They cannot run the second consensus review until the attestor verifies the
exact Base receipt and the relay binds that deposit. An abandoned reservation
expires back to the underlying pending ruling, and an unactivated Base deposit
is recoverable by its payer. Zero-bond appeals activate immediately.

## Settlement state machine

Every Base settlement authorization binds:

- chain ID and escrow address through the EIP-712 domain;
- bounty, attempt, outcome, payout, and recipients;
- a canonical hash of freshly read GenLayer state;
- the next strictly increasing bounty decision nonce;
- `validAfter` and `validBefore` timestamps.

The transaction must come from the configured relayer and the signature must
recover the configured decision signer. The escrow also enforces funded
challenger identity, one-time reward/attempt settlement, payout conservation,
and single-use state hashes. Settlement credits `claimable`; `claim()` performs
the token transfer under a reentrancy guard.

Base does not verify GenLayer consensus cryptographically. The current testnet
relay and signer use separate keys on one Fly service, so host compromise is a
known trust boundary. See [CROSS_CHAIN_SECURITY.md](CROSS_CHAIN_SECURITY.md).

## Indexing and evidence archive

GenLayer does not expose an EVM-style event stream. The indexer polls bounty
and attempt views, diffs them against Postgres, and creates activity and
notification rows. Payment-critical code re-reads GenLayer directly rather
than trusting cached rows.

Evidence URLs are independently re-fetched by an SSRF-hardened archiver. DNS
answers are validated and pinned, private/reserved ranges are rejected,
redirects are revalidated, and response time/size are bounded. It records
SHA-256 plus the contract-compatible FNV-1a fingerprint. Archival is provenance
support, not adjudication authority.

## Applications

- Frontend: Next.js `16.3.3`, React `19.2.8`, ethers v6, GenLayer JS, Reown.
- API: Fastify, Prisma/Postgres, Redis, ethers v6, GenLayer JS.
- API health: `/livez` for machine health and `/health` for indexer state.
- Production frontend: <https://proof-bounty.vercel.app>
- Production API: <https://proofbounty-usdc-api.fly.dev>

## Verification structure

- `contracts/base/test/ProofBountyEscrow.t.sol`: thirteen Foundry tests covering
  funding identity, recovery, settlement authorization, conservation, and the
  complete fund-bind-settle-claim path.
- `tests/integration/test_proof_bounty.py`: 40 GenLayer tests. Five selected
  deterministic direct tests are run in the documented offline verification.
- `scripts/00-reviewer-verify.mjs`: read-only deployed-source and critical-state
  verification.
- `.github/workflows/ci.yml`: Foundry, contract lint/direct tests, frontend,
  backend, and dependency jobs. GitHub runner startup is currently blocked by
  the repository owner's account billing lock.
