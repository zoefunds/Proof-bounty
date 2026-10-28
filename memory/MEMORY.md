# ProofBounty current project memory

This file intentionally contains only current operational state. Historical
deployment narratives and retired addresses were removed because they were
being mistaken for production configuration.

## Production

- GenLayer adjudication: `0x89322f6fc61872B812E4BE9E647F2154B7f73BE1`
- Base Sepolia escrow: `0xEA3Ee1bD267C343c6C8e7C8C24bcfd401836dC83`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: `https://proof-bounty.vercel.app`
- API/relay: `https://proofbounty-usdc-api.fly.dev`
- Fly app/database: `proofbounty-usdc-api` / `proofbounty-usdc-db`
- Release source: current `main` branch.

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

## Live roles

- Base owner/treasury: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Base relayer: `0x80f75Ac534d43f9e17941Ab95c14B67c57c8878e`
- Base decision signer: `0xDd2F40c795039Fa3fDBC812D27BDb34acf52f907`
- GenLayer funding attestor: `0x62c053704985903BF36129c999Fe6DBCBD9D06B7`

Private keys are encrypted Fly secrets. Do not write them into this repository
or documentation.

## Verification status

- Foundry Base suite: 13/13 passing.
- Backend appeal reconciliation suite: 4/4 passing.
- Selected deterministic GenLayer direct suite: 5/5 passing.
- API typecheck/build and Prisma generation: passing.
- Frontend lint/typecheck and Vercel production build: passing.
- Deployed GenLayer source matches `contracts/proof_bounty.py` exactly.
- Production API health is good.
- GitHub Actions runner startup is blocked by the repository owner's billing
  lock; workflow steps do not currently execute.

The authoritative details are `MILESTONE-USDC.md`,
`docs/CROSS_CHAIN_SECURITY.md`, `docs/DEPLOYMENT.md`, and
`docs/VERIFICATION.md`.
