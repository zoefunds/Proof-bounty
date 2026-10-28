# Milestone verification record

Verified on 2026-10-28 against commit contents in this release.

## Deployed components

- GenLayer adjudication: `0x9482012290132518c88D967623A15C3DDD0d247E`
- Base Sepolia escrow: `0xA99384bc4e6c045bBFD239Bbc9297a5C144AF711`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

The Base deployment transaction is
`0x11bc25198d1f79aa7cc09b85cbb6f357624c7812094c80f34369ffcdeffbc1ff`.
The GenLayer deployment transaction is
`0x7e3f93ba9ac0651c4d40de95073c593f0798db789bcbb40b51c089b4f5771f12`.

## Reproducible checks

```bash
forge test -vv
genvm-lint check contracts/proof_bounty.py --json
gltest tests/integration -v -s -k "is_a_safe_noop or human_override"
(cd apps/api && npm ci && npx tsc --noEmit && npx prisma generate && npm run build)
(cd apps/web && npm ci && npm run lint && npx tsc --noEmit && npm run build)
```

The Foundry suite includes the complete Base flow: identity-authorized funding,
reservation binding, nonce- and time-bound settlement, recipient accounting,
and pull claim. It also exercises index squatting, mismatched identities,
unauthorized binding, stale/conflicting/expired decisions, replay, and both
signature-free delayed recovery paths.

The direct GenLayer tests demonstrate that arbitrary unfunded reservations do
not consume the funded-attempt cap and that only the configured funding
attestor can activate a reservation.

## CI availability

The workflow contains dedicated Foundry, GenLayer, frontend, backend, and
dependency jobs. At the time of verification, GitHub refused to start any job
with: `The job was not started because your account is locked due to a billing
issue.` Restore the repository owner's GitHub billing status and rerun the
workflow; no repository change can bypass that account-level lock.
