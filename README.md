# ProofBounty

ProofBounty is a marketplace for claims verified from public web evidence.
GenLayer adjudicates evidence and disputes; Base Sepolia holds and settles
six-decimal USDC. GenLayer never holds tokens.

## Production deployment

| Component | Production value |
|---|---|
| Frontend | <https://proof-bounty.vercel.app> |
| API, indexer, and relay | <https://proofbounty-usdc-api.fly.dev> |
| GenLayer StudioNet adjudication | `0x0B083A0618C408cd4Af32EF4e507fE13e1184e66` |
| Base Sepolia escrow | `0x71A6C9f3eA9026009b51463013743e4781F327c9` |
| Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base chain ID | `84532` |

The deployed GenLayer source matches `contracts/proof_bounty.py` byte-for-byte.
Deployment transactions, live roles, and verification results are recorded in
[docs/VERIFICATION.md](docs/VERIFICATION.md).

## Protocol lifecycle

1. A creator records the claim, criteria, deadline, reward, bond, fee, and
   arbiter on GenLayer.
2. The creator deposits the exact USDC reward into `ProofBountyEscrow` on Base.
   The relay registers it only when Base and GenLayer terms match.
3. A challenger calls `reserve_attempt`. The two-hour reservation does not
   consume the 40 funded-attempt limit.
4. The backend reads the finalized reservation and issues a short-lived
   EIP-712 authorization bound to the exact challenger and funding terms.
5. After Base funding, the backend verifies the receipt and event. The
   dedicated GenLayer funding attestor activates the reservation, and the Base
   relay binds the finalized attempt index.
6. GenLayer validators independently retrieve and judge the submitted page
   against the immutable criteria.
7. Disputes receive an advisory arbiter ruling followed by a second GenLayer
   consensus round. A human ruling is never the final settlement authority.
8. The relay re-reads finalized state and submits a nonce- and time-bound
   EIP-712 settlement. Base credits `claimable`; recipients call `claim()`.

Verdicts are `APPROVED`, `PARTIAL`, `REJECTED`, `NEEDS_REVISION`, and
`INSUFFICIENT_EVIDENCE`. The first favorable funded attempt wins; other live
attempts become `LOST_RACE` and can recover their bonds.

## Security boundary

- Base cannot natively verify GenLayer consensus. The testnet relay and
  decision signer are distinct identities but run on the same Fly service.
  Compromise of that host can authorize a false settlement. This is disclosed
  testnet trust, not a trustless bridge.
- Funding authorizations prevent another wallet from occupying a challenger's
  reservation, and unfunded reservations never consume attempt capacity.
- Bounty funding is authorized for the finalized GenLayer creator; recovered
  orphan deposits release the predictable Base bounty slot for a clean retry.
- Appeal funding is authorized only for the finalized GenLayer appellant.
- Positive-bond appeals remain pending and non-resolvable until the funding
  attestor verifies the exact Base deposit and the relay binds it. Abandoned
  reservations expire after two hours; unactivated deposits are recoverable.
  Zero-bond appeals activate immediately without a nonexistent deposit.
- Recovery after GenLayer activation does not destroy reconciliation: the
  attempt remains bindable with a zero bond after the bond refund.
- Settlements bind every economic field, a canonical GenLayer state hash, a
  strictly increasing nonce, and a ten-minute validity window.
- Replay, stale/conflicting nonces, expiry, tampering, wrong callers/signers,
  and challenger mismatches revert.
- Creator orphan recovery is signature-free after seven days. Challenger
  unbound-funding recovery is signature-free after authorization expiry plus
  24 hours.
- Settlement uses pull claims and a reentrancy guard.

See [docs/CROSS_CHAIN_SECURITY.md](docs/CROSS_CHAIN_SECURITY.md) for the full
trust and recovery model.

## Repository

```text
contracts/proof_bounty.py       GenLayer adjudication contract
contracts/base/                 Base USDC escrow and Foundry tests
apps/web/                       Next.js 16 / React 19 frontend
apps/api/                       Fastify API, indexer, attestor, and Base relay
tests/integration/              40 GenLayer tests
scripts/00-reviewer-verify.mjs  Read-only deployed-source/state verification
docs/                           Architecture, security, deployment, operations
memory/MEMORY.md                Current operational snapshot
```

Numbered scripts after `00` are retained historical adjudication traces from
before the USDC reservation milestone. They are not the current cross-chain
runbook.

## Verification

```bash
forge test -vv
genvm-lint lint contracts/proof_bounty.py --json
gltest tests/integration -v -s -k "is_a_safe_noop or human_override"
(cd apps/api && npm ci && npx tsc --noEmit && npx prisma generate && npm run build)
(cd apps/web && npm ci && npm run lint && npx tsc --noEmit && npm run build)
```

Current results: Foundry 14/14, backend appeal reconciliation 5/5, selected
deterministic GenLayer direct tests 5/5, backend build passing, and frontend
production build passing. GitHub
Actions contains these jobs, but GitHub currently refuses to start runners
because the repository owner's account is billing-locked.

## Local development

```bash
cd apps/web
cp .env.example .env.local
npm ci
npm run dev
```

```bash
cd apps/api
cp .env.example .env
docker compose up -d
npm ci
npx prisma migrate dev
npm run dev
```

Never put production private keys in a committed file. Use distinct local
development keys for relay, decision signing, and funding attestation.

## Documentation

- [USDC milestone](MILESTONE-USDC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Cross-chain security](docs/CROSS_CHAIN_SECURITY.md)
- [Security operations](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Environment variables](docs/ENVIRONMENT.md)
- [Verification record](docs/VERIFICATION.md)
- [Contract invariant review](docs/CONTRACT_REVIEW.md)
- [Contributing](docs/CONTRIBUTING.md)
