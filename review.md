# Cross-chain review remediation

This is the current response to the funding and settlement integrity review of
commit `3d49ee7323e1a2731c12e5e4154d867b1ff5ba4c`.

| Finding | Remediation | Proof |
|---|---|---|
| Any wallet could occupy an attempt index | Funding targets an expiring GenLayer reservation and requires an EIP-712 authorization for the exact challenger | `testAttemptFundingIsIdentityBoundAndSquattingFails` |
| Unfunded attempts could exhaust the cap | Reservations consume no slot; only attestor-confirmed funding creates an attempt | GenLayer direct reservation-cap test |
| Settlement trusted stale/conflicting instructions | State hashes, nonces, validity windows, full field binding, separate caller/signature checks | `testStaleAndConflictingSettlementInstructionsFail` |
| Recovery required a privileged signature | Creator orphan and challenger unbound-funding recovery are delayed but signature-free | Foundry recovery tests |
| Frontend inferred a stale attempt index | It reconciles the finalized reservation and activated index | Current bounty funding flow |
| Base tests were absent from CI | CI now has a dedicated Foundry job | `.github/workflows/ci.yml` |

Production remediation commit:
`6e86ecba383615102bcc4bd0dad62356ed458c48`.

- GenLayer: `0x9482012290132518c88D967623A15C3DDD0d247E`
- Base escrow: `0xA99384bc4e6c045bBFD239Bbc9297a5C144AF711`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

See [docs/CROSS_CHAIN_SECURITY.md](docs/CROSS_CHAIN_SECURITY.md) and
[docs/VERIFICATION.md](docs/VERIFICATION.md). GitHub currently prevents jobs
from starting because the repository owner's account is billing-locked; this
is not a test failure.
