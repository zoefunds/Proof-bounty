# Cross-chain review remediation

This is the current response to the funding and settlement integrity reviews.

| Finding | Remediation | Proof |
|---|---|---|
| Any wallet could occupy an attempt index | Funding targets an expiring GenLayer reservation and requires an EIP-712 authorization for the exact challenger | `testAttemptFundingIsIdentityBoundAndSquattingFails` |
| Unfunded attempts could exhaust the cap | Reservations consume no slot; only attestor-confirmed funding creates an attempt | GenLayer direct reservation-cap test |
| Settlement trusted stale/conflicting instructions | State hashes, nonces, validity windows, full field binding, separate caller/signature checks | `testStaleAndConflictingSettlementInstructionsFail` |
| Recovery required a privileged signature | Creator orphan and challenger unbound-funding recovery are delayed but signature-free | Foundry recovery tests |
| Frontend inferred a stale attempt index | It reconciles the finalized reservation and activated index | Current bounty funding flow |
| Base tests were absent from CI | CI now has a dedicated Foundry job | `.github/workflows/ci.yml` |
| Predictable bounty IDs could be occupied | Bounty funding requires finalized-creator authorization; recovery deletes the slot | bounty squatting and orphan-reuse Foundry tests |
| Arbitrary wallets could pre-fund appeals | Appeal funding requires finalized-appellant authorization and expiry | appeal authorization Foundry tests |
| Recovery after activation made binding impossible | Recovered positions remain bindable with a zero bond, preserving reward settlement without double bond payment | activated-recover-bind-settle Foundry test |
| Unfunded or merely attested appeals could obtain review rights | funding verification enters a non-resolvable pending-binding state; only post-bind attestation activates, while partial failures expire and reconcile | GenLayer direct, Foundry cross-chain recovery, and backend tests |
| Base binding could win the race against GenLayer expiry | bound orphan defers settlement; after seven days, a fresh state-bound authorization permits direct appellant recovery only when GenLayer proves abandonment | bound-expiry Foundry and backend eligibility tests |
| Timer-only bound recovery could erase an active appeal penalty | bound recovery now requires zero declared GenLayer appeal bond, no finalized recipient, matching appellant/funding hash, canonical state hash, and short expiry; recovered state cannot waive a nonzero finalized recipient | active-appeal adverse-outcome Foundry test and backend recovery/reconciliation tests |

This document tracks the current `main` release.

- GenLayer: `0x8A27ead9Db4Aa269eC5b298129270E23e63ADCA2`
- Base escrow: `0x4fD51A722A6E7Eb939Ba790b58759E12CB2dd2c6`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

See [docs/CROSS_CHAIN_SECURITY.md](docs/CROSS_CHAIN_SECURITY.md) and
[docs/VERIFICATION.md](docs/VERIFICATION.md). GitHub currently prevents jobs
from starting because the repository owner's account is billing-locked; this
is not a test failure.
