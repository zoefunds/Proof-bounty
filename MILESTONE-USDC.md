# ProofBounty USDC milestone

Production milestone completed on 2026-10-28. This document is the
authoritative description of the new payment boundary; older GEN escrow
descriptions in historical review notes describe the retired architecture.

## Live contracts

| Layer | Network | Address | Responsibility |
|---|---|---|---|
| Adjudication | GenLayer StudioNet | `0x8566beF0B3507415F29229a9D9A26BF41a9cA505` | Evidence fetch, validator consensus, disputes, final state |
| Payments | Base Sepolia | `0x6DC21933ec3D013542185482850C96c753d10cfc` | USDC custody, allocation, pull claims |
| Token | Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Six-decimal settlement asset |

## Live applications

- Frontend: `https://proof-bounty.vercel.app`
- Backend/API and relay: `https://proofbounty-usdc-api.fly.dev`
- Fly Postgres: `proofbounty-usdc-db` (fresh milestone database)
- The legacy `proofbounty-api` app is abandoned and is not part of this deployment.

The failed GenLayer constructor attempt at
`0x0B187f7ba42F6e082b929a70A155A36266b24aD3` is retired and must never be
configured. Its constructor execution errored and it has no usable state.
The successful but documentation-stale intermediate deployment at
`0xD4bd3EFc166298b899f8Fb4334BC0B6Bcd535694` is also retired.

## Trust and safety boundary

- GenLayer entrypoints are non-payable. `get_contract_balance()` is a
  compatibility view that always returns zero.
- Base uses pull payments: a relay only credits `claimable`; recipients call
  `claim()` themselves.
- A Base decision requires both the configured relayer transaction and an
  EIP-712 authorization bound to chain id, escrow address, bounty, attempt,
  outcome, payout, recipients, and decision hash.
- Decision hashes are single-use and every reward/attempt ledger is
  single-settlement.
- Winner identity must equal the wallet that funded the corresponding Base
  attempt. An unbacked GenLayer winner cannot receive USDC; the relay refunds
  the creator instead.
- A mismatched bounty deposit is refused during registration. An unregistered
  deposit has a signed seven-day orphan recovery path.
- Fees and partial payouts conserve every USDC base unit; rounding remainder
  returns to the creator.
- The testnet escrow uses distinct service identities: relayer
  `0x06bcA7F8f30816a7Fe58663e1625c4473c2A6283` and decision signer
  `0x74AE7a1dC90a92Ae7C72fFbA513B471A0ac5c138`. Their private keys are held
  only in the local OS keychain and as encrypted Fly secrets. The owner/treasury remains the deployment wallet; use a multisig
  before mainnet.

## End-to-end lifecycle

1. The creator writes declared six-decimal USDC terms to GenLayer.
2. The same wallet approves and deposits the exact reward into Base escrow.
3. The relay compares creator, reward, bond, fee, bounty id, and GenLayer
   contract before registering the deposit.
4. A challenger accepts on GenLayer, then funds the matching Base attempt.
5. GenLayer fetches and adjudicates evidence. It updates state only.
6. The relay derives an EIP-712 instruction from finalized indexed state.
7. Base credits winner/refund/forfeit/fee balances exactly once.
8. Each recipient claims USDC from Base with their own wallet.

The relay runs as an independent two-minute sweep. A Base RPC or relay failure
does not block GenLayer adjudication; the next sweep retries idempotently.

## Verification completed

- `forge test`: 4/4 Base escrow adversarial tests pass.
- API TypeScript build and Prisma generation pass.
- Web TypeScript and ESLint pass.
- Offline GenLayer dispute/appeal adjudication tests pass.
- Live GenLayer reads: counter `0`, balance `0`, fee `250`; schema reports
  non-payable write methods.
- Live Base reads confirm USDC, owner, relayer, decision signer, treasury, and
  the 10,000 BPS denominator.

Public Sourcify publication was not performed because external source export
requires separate approval. Local source-to-bytecode tests and live getter
checks remain available in this repository.
