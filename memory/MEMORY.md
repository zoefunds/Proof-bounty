# ProofBounty current project memory

This file intentionally contains only current operational state. Historical
deployment narratives and retired addresses were removed because they were
being mistaken for production configuration.

## Production

- GenLayer adjudication: `0x043b97cB152Bf930017d48aD05FA631004c7158f`
- Base Sepolia escrow: `0xF93548faf36D2d613A41f3e6A85D9C98bFF50dEf`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: `https://proof-bounty.vercel.app`
- API/relay: `https://proofbounty-usdc-api.fly.dev`
- Fly app/database: `proofbounty-usdc-api` / `proofbounty-usdc-db`
- Release source: current `main` branch.
- Live namespace: 2 indexed bounties, both reward-funded and Base-registered,
  with 12 USDC held for rewards in aggregate.
- API release: Fly `v23` (`3Ao2wbV00g5oQUD2p9Y0ZBq2X`).
- Frontend deployment: Vercel `dpl_3SNYVbwQHuGi7b1vAnM4upgT531C`.

GenLayer is adjudication-only and all write methods are non-payable. Base is
the only token custodian. Payments use six-decimal USDC.

## Cross-chain model

Challengers first create expiring GenLayer reservations. Reservations consume
no funded-attempt capacity. A short-lived EIP-712 authorization binds Base
funding to the reservation's exact challenger. The backend verifies the Base
receipt/event, uses a dedicated attestor to activate the GenLayer attempt, and
binds the exact finalized attempt index on Base.

Settlement uses a separate Base relayer and EIP-712 decision signer, canonical
GenLayer state hashes, per-bounty nonces, and validity windows. The keys are
distinct but currently share one Fly host, which is an explicit testnet trust
assumption. Delayed creator/challenger recovery needs no service signature.
For appeals, unbound collateral recovers one day after authorization expiry.
Bound collateral uses the seven-day orphan delay and then requires a
short-lived authorization derived from fresh finalized GenLayer state proving
the appeal expired without a recipient. Base cannot prove GenLayer state, so
the decision signer remains the disclosed testnet oracle; use verified or
threshold authorization before mainnet.

## Live roles

- Base owner/treasury: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Base relayer: `0x80f75Ac534d43f9e17941Ab95c14B67c57c8878e`
- Base decision signer: `0xDd2F40c795039Fa3fDBC812D27BDb34acf52f907`
- GenLayer funding attestor: `0x62c053704985903BF36129c999Fe6DBCBD9D06B7`

Private keys are encrypted Fly secrets. Do not write them into this repository
or documentation.

## Verification status

- Foundry Base suite: 16/16 passing.
- Backend appeal integrity suite: 12/12 passing.
- Selected deterministic GenLayer direct suite: 6/6 passing.
- API typecheck/build and Prisma generation: passing.
- Frontend lint/typecheck and Vercel production build: passing.
- Deployed GenLayer source matches `contracts/proof_bounty.py` exactly.
- Production API health is good.
- Production route/API E2E matrix: all checks in `docs/E2E-TESTS.md` passing.
- GitHub Actions runner startup is blocked by the repository owner's billing
  lock; workflow steps do not currently execute.

The authoritative details are `MILESTONE-USDC.md`,
`docs/CROSS_CHAIN_SECURITY.md`, `docs/DEPLOYMENT.md`, and
`docs/VERIFICATION.md`.
