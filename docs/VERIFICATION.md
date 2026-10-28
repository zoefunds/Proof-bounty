# Milestone verification record

Verified on 2026-10-28 against commit contents in this release.

The current pair was deployed fresh so its bounty-ID namespace cannot collide
with positions registered by the preceding GenLayer contract. The derived
Postgres index/cache was cleared after the cutover; live health reports
`lastBountyCount: 0`, `cachedBounties: 0`, and no indexer error.

## Deployed components

- GenLayer adjudication: `0x0B083A0618C408cd4Af32EF4e507fE13e1184e66`
- Base Sepolia escrow: `0x71A6C9f3eA9026009b51463013743e4781F327c9`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

The Base deployment transaction is
`0xe460458d84e3ee662ff61af8b91755e3ac15e6273b1c53ed12b6e1bf27c5ab44`.
The GenLayer deployment transaction is
`0x8d5a30729755a15a9a628d7a907c1815efee53ae29245ba6be605bbcbbda7312`.
The funding-attestor configuration transaction is
`0xae58b0f5b73ed2f3fd7a72af9acdb5b5419445123ce2cf816c89f27069cc03f3`.

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

The 14-test Foundry suite includes the complete Base flow: identity-authorized funding,
reservation binding, nonce- and time-bound settlement, recipient accounting,
and pull claim. It also exercises index squatting, mismatched identities,
unauthorized binding, stale/conflicting/expired decisions, replay, and both
signature-free delayed recovery paths. It specifically proves creator-bound
bounty funding with slot reuse after orphan recovery, eligible-appellant-only
appeal funding, and late zero-bond binding after a recovered reservation whose
GenLayer attempt had already activated.

The appeal-integrity regressions prove that zero-bond appeals settle without a
deposit, positive-bond appeals cannot resolve before attestation, unauthorized
attestors cannot activate them, abandoned reservations expire safely, and a
properly funded and Base-bound appeal pays the finalized recipient. Five
backend tests reject missing, unbound, and mismatched positive collateral.

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
