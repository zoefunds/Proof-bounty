# Milestone verification record

Verified on 2026-10-28 against commit contents in this release.

The current pair was deployed fresh so its bounty-ID namespace cannot collide
with positions registered by the preceding GenLayer contract. The derived
Postgres index/cache was cleared after the cutover; live health reports
`lastBountyCount: 0`, `cachedBounties: 0`, and no indexer error.

## Deployed components

- GenLayer adjudication: `0x89322f6fc61872B812E4BE9E647F2154B7f73BE1`
- Base Sepolia escrow: `0xEA3Ee1bD267C343c6C8e7C8C24bcfd401836dC83`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

The Base deployment transaction is
`0x3e932ab5231334eb9164d1bb6c3e3d5c449cbd4b8513e54f96d4208ff7c88189`.
The GenLayer deployment transaction is
`0x13ebb667d51b2eeb80aa37987fd02e1bf19c4c41690cb853eae3fa1e96cdf063`.
The funding-attestor configuration transaction is
`0x12fa6649d412019060d287775e646da0aaed9639b05e87bad6796498f89154d2`.

Live reads on the current deployment report GenLayer bounty count `0`, contract
balance `0`, and fee `250`. Base getters resolve to the USDC, relayer, decision
signer, attestor, and treasury documented for this release. The production API
reports `lastBountyCount: 0`, `cachedBounties: 0`, and no indexer error. Prior
deployment records are intentionally retained only in Git history so they
cannot be mistaken for current operational data.

## Reproducible checks

```bash
forge test -vv
genvm-lint lint contracts/proof_bounty.py --json
gltest tests/integration -v -s -k "is_a_safe_noop or human_override"
(cd apps/api && npm ci && npm test && npx tsc --noEmit && npx prisma generate && npm run build)
(cd apps/web && npm ci && npm run lint && npx tsc --noEmit && npm run build)
```

The 13-test Foundry suite includes the complete Base flow: identity-authorized funding,
reservation binding, nonce- and time-bound settlement, recipient accounting,
and pull claim. It also exercises index squatting, mismatched identities,
unauthorized binding, stale/conflicting/expired decisions, replay, and both
signature-free delayed recovery paths. It specifically proves creator-bound
bounty funding with slot reuse after orphan recovery, eligible-appellant-only
appeal funding, and late zero-bond binding after a recovered reservation whose
GenLayer attempt had already activated.

The appeal-liveness regressions prove both required timing cases: a zero-bond
appeal settles and claims without a Base appeal deposit, while a positive-bond
appeal finalized before Base funding can be funded later, settled, and claimed.
Four backend reconciliation tests additionally prove immediate zero-bond
settlement, late-deposit allocation, amount mismatch rejection, and the
seven-day fallback that waives only an appeal bond that never existed.

The direct GenLayer tests demonstrate that arbitrary unfunded reservations do
not consume the funded-attempt cap and that only the configured funding
attestor can activate a reservation.

`genvm-lint lint` passes all three deterministic AST safety checks. The
linter's combined `check` command cannot currently retrieve the historical
pinned SDK tarball from its own artifact registry; that tool-distribution
failure is not hidden as a source failure. Executable semantics are covered by
the five passing offline `gltest.direct` cases and by the finalized StudioNet
deployment and transactions above.

## CI availability

The workflow contains dedicated Foundry, GenLayer, frontend, backend, and
dependency jobs. The latest verified run for the integrity release is
[`40697106729`](https://github.com/zoefunds/Proof-bounty/actions/runs/40697106729).
GitHub refused to start every runner with: `The job was not started because
your account is locked due to a billing issue.` Restore the repository owner's
GitHub billing status and rerun the workflow; no repository change can bypass
that account-level lock.
