# Milestone verification record

Verified on 2026-10-28 against commit contents in this release.

## Deployed components

- GenLayer adjudication: `0xdea68d6935dC32A59aFD7063356948c8cfA5E972`
- Base Sepolia escrow: `0x642657E3e73091f15354Ca139bC07340fB95e21e`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

The Base deployment transaction is
`0x261acdd23ea42f77142541f3c1992f0ee4323fb550fbe97563920dc620f0ed32`.
The GenLayer deployment transaction is
`0x98d24c2bd3dc75b9806ef3ba8fad6b16bca61380542782d96daa9f63a9003bd3`.
The funding-attestor configuration transaction is
`0x22e9c56de202368f887ceeb0d38aa54083839116b42bae9a630138c1000e1dd1`.

## Finalized cross-chain testnet trace

This trace used bounty `0` and attempt `0` on the deployed contracts above.
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
(cd apps/api && npm ci && npx tsc --noEmit && npx prisma generate && npm run build)
(cd apps/web && npm ci && npm run lint && npx tsc --noEmit && npm run build)
```

The 11-test Foundry suite includes the complete Base flow: identity-authorized funding,
reservation binding, nonce- and time-bound settlement, recipient accounting,
and pull claim. It also exercises index squatting, mismatched identities,
unauthorized binding, stale/conflicting/expired decisions, replay, and both
signature-free delayed recovery paths. It specifically proves creator-bound
bounty funding with slot reuse after orphan recovery, eligible-appellant-only
appeal funding, and late zero-bond binding after a recovered reservation whose
GenLayer attempt had already activated.

The direct GenLayer tests demonstrate that arbitrary unfunded reservations do
not consume the funded-attempt cap and that only the configured funding
attestor can activate a reservation.

`genvm-lint lint` passes all three deterministic AST safety checks. The
linter's combined `check` command cannot currently retrieve the historical
pinned SDK tarball from its own artifact registry; that tool-distribution
failure is not hidden as a source failure. Executable semantics are covered by
the four passing offline `gltest.direct` cases and by the finalized StudioNet
deployment and transactions above.

## CI availability

The workflow contains dedicated Foundry, GenLayer, frontend, backend, and
dependency jobs. At the time of verification, GitHub refused to start any job
with: `The job was not started because your account is locked due to a billing
issue.` Restore the repository owner's GitHub billing status and rerun the
workflow; no repository change can bypass that account-level lock.
