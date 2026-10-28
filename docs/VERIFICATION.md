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

## Archived finalized cross-chain testnet trace

This trace used bounty `0` and attempt `0` on the immediately preceding paired
deployment. It remains transaction evidence for the same escrow code, while
the fresh addresses above isolate the corrected GenLayer bounty namespace.
All amounts below are six-decimal Base Sepolia USDC units.

1. GenLayer bounty creation finalized in
   `0x91e3ee35e8ea0c579969ddb8d27b2852b5be5774b3e13b25289de0032ad58029`.
2. The authenticated creator deposited the 100,000-unit reward on Base in
   `0xf4732068c38a17ea80deda5440525a0a860bfafbcbbc339f3d498d8720108935`.
3. The challenger reserved its GenLayer identity in
   `0x53f0ae04f928c90b54e21274586194f8f201cdac18f5680357d92da7e4cc6278`,
   then deposited the exact 100,000-unit Base bond in
   `0xdf211dd07cf1c7581efc0631e84b0d9a0fb789a6d77372dd1b05daf2ab4ed4ad`.
4. Receipt verification activated the GenLayer attempt in
   `0x716aff31b8cb45447883aab64eaeadb17cabc9be96865fdd3caab42c79fdb065`
   and bound the same reservation on Base in
   `0x9712516a9d320efb6b5e7d007e6b6262a972ddd41ead4e550b5189c866120168`.
5. GenLayer independently fetched and adjudicated the submitted evidence.
   The final consensus round was
   `0xbc2547e1728773fb0be114652bcd912ac82d309edd08d71a022e0f0bbc339364`.
   It rejected the evidence after the revision limit; this deliberately
   exercises the forfeiture branch rather than claiming a favorable result.
6. The creator finalized that GenLayer forfeiture in
   `0x7620dd07de6ccd93f70da9be4c58b34f403c1fa4e446bd86688ecb7eddad88e5`.
   The production relay executed the exact signed Base allocation in
   `0x5955ccc1039dd47a438ddf8ccf374f4df801e943405bfe791cb5821d7252dd9c`.
7. The credited recipient pulled the 100,000-unit USDC balance in
   `0x3f4de515328430050e02a5c17b70f8802425c2d7f8b74b0ff3e481b50b010e57`.

The source-level Foundry end-to-end test additionally covers the successful
winner branch (reward plus returned bond, fee allocation, and recipient
claim), while this public trace proves the deployed rejected/forfeited branch.

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
[`40693072602`](https://github.com/zoefunds/Proof-bounty/actions/runs/40693072602).
GitHub refused to start every runner with: `The job was not started because
your account is locked due to a billing issue.` Restore the repository owner's
GitHub billing status and rerun the workflow; no repository change can bypass
that account-level lock.
