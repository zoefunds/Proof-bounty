# ProofBounty USDC milestone

Production milestone completed on 2026-10-28. This document is the
authoritative description of the new payment boundary; older GEN escrow
descriptions in historical review notes describe the retired architecture.

## Live contracts

| Layer | Network | Address | Responsibility |
|---|---|---|---|
| Adjudication | GenLayer StudioNet | `0x9482012290132518c88D967623A15C3DDD0d247E` | Evidence fetch, validator consensus, disputes, final state |
| Payments | Base Sepolia | `0xA99384bc4e6c045bBFD239Bbc9297a5C144AF711` | USDC custody, allocation, pull claims |
| Token | Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Six-decimal settlement asset |

## Live applications

- Frontend: `https://proof-bounty.vercel.app`
- Backend/API and relay: `https://proofbounty-usdc-api.fly.dev`
- Fly Postgres: `proofbounty-usdc-db` (fresh milestone database)
- The legacy `proofbounty-api` app is abandoned and is not part of this deployment.

The former GenLayer deployment `0x8566C605cc1Ffa137312EbE95C77f7294C3412F4`,
the superseded V2 deployment `0x19943914693743949b7B7c6820ae5E81331909bB`,
and the former Base escrow `0x6DCf8d1D8b1A6B5Bc88a39DBA037aC20246B58d3`
are retired and must never be configured.

## Trust and safety boundary

The cross-chain attestor/decision signer is an explicit testnet trust
assumption; Base does not natively verify GenLayer consensus. See
[`docs/CROSS_CHAIN_SECURITY.md`](docs/CROSS_CHAIN_SECURITY.md) for the exact
reservation protocol, signer authority, failure recovery, and reproducible
adversarial tests.

- GenLayer entrypoints are non-payable. `get_contract_balance()` is a
  compatibility view that always returns zero.
- Base uses pull payments: a relay only credits `claimable`; recipients call
  `claim()` themselves.
- A Base decision requires both the configured relayer transaction and an
  EIP-712 authorization bound to chain id, escrow address, bounty, attempt,
  outcome, payout, recipients, and decision hash.
- Decision hashes are single-use and every reward/attempt ledger is
  single-settlement.
- Settlement instructions also carry a per-bounty monotonic nonce and a
  ten-minute validity window; stale, conflicting, expired, replayed, and
  field-tampered instructions revert.
- Pending GenLayer reservations do not consume funded-attempt capacity. Base
  funding is identity-bound and short-lived, and only attested funding becomes
  an adjudication attempt.
- Winner identity must equal the wallet that funded the corresponding Base
  attempt. An unbacked GenLayer winner cannot receive USDC; the relay refunds
  the creator instead.
- A mismatched bounty deposit is refused during registration. An unregistered
  deposit is recoverable by its creator after seven days without a service
  signature.
- Fees and partial payouts conserve every USDC base unit; rounding remainder
  returns to the creator.
- The testnet escrow uses distinct service identities: relayer
  `0x80f75Ac534d43f9e17941Ab95c14B67c57c8878e` and decision signer
  `0xDd2F40c795039Fa3fDBC812D27BDb34acf52f907`. GenLayer funding activation is
  restricted to attestor `0x62c053704985903BF36129c999Fe6DBCBD9D06B7`.
  Private keys are stored as encrypted Fly secrets. The owner/treasury remains
  the deployment wallet; use independent infrastructure and a multisig or
  threshold oracle before mainnet.

## End-to-end lifecycle

1. The creator writes declared six-decimal USDC terms to GenLayer.
2. The same wallet approves and deposits the exact reward into Base escrow.
3. The relay compares creator, reward, bond, fee, bounty id, and GenLayer
   contract before registering the deposit.
4. A challenger reserves on GenLayer. The reservation consumes no attempt
   capacity. A short-lived identity-bound authorization funds Base, then the
   attestor activates the exact finalized attempt index and the relay binds it.
5. GenLayer fetches and adjudicates evidence. It updates state only.
6. The relay derives an EIP-712 instruction from finalized indexed state.
7. Base credits winner/refund/forfeit/fee balances exactly once.
8. Each recipient claims USDC from Base with their own wallet.

The relay runs as an independent two-minute sweep. A Base RPC or relay failure
does not block GenLayer adjudication; the next sweep retries idempotently.

## Verification completed

- `forge test`: 8/8 Base escrow adversarial and end-to-end tests pass.
- API TypeScript build and Prisma generation pass.
- Web TypeScript and ESLint pass.
- Offline GenLayer dispute/appeal adjudication tests pass.
- Live GenLayer reads: counter `0`, balance `0`, fee `250`; schema reports
  non-payable write methods.
- Live Base reads confirm USDC, owner, relayer, decision signer, treasury, and
  the 10,000 BPS denominator.

The current GitHub Actions jobs cannot start because GitHub reports that the
repository owner's account is locked for a billing issue. This is an account
condition rather than a test failure; the same CI commands pass locally. The
workflow now includes the Base Foundry suite and will execute after billing is
restored.
