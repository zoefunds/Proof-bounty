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

This document tracks the current `main` release.

- GenLayer: `0xdea68d6935dC32A59aFD7063356948c8cfA5E972`
- Base escrow: `0x642657E3e73091f15354Ca139bC07340fB95e21e`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

See [docs/CROSS_CHAIN_SECURITY.md](docs/CROSS_CHAIN_SECURITY.md) and
[docs/VERIFICATION.md](docs/VERIFICATION.md). GitHub currently prevents jobs
from starting because the repository owner's account is billing-locked; this
is not a test failure.
