# Milestone verification record

Verified on 2026-10-28 against commit contents in this release.

The current pair was deployed fresh so its bounty-ID namespace cannot collide
with positions registered by the preceding GenLayer contract. The derived
Postgres index/cache was cleared after the cutover; live health reports
`lastBountyCount: 0`, `cachedBounties: 0`, and no indexer error.

## Deployed components

- GenLayer adjudication: `0x8A27ead9Db4Aa269eC5b298129270E23e63ADCA2`
- Base Sepolia escrow: `0xFC271817DA30f1BEf651ef5BacDd1a37127f0976`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

The Base deployment transaction is
`0x82d5abb6d8e9d2e9a88ebaa0a66f98d2e11ac57a93430c0564642591e0883235`.
The GenLayer deployment transaction is
`0x27f25577a43754f9609f323708e8791612c67eb440be95521abf8ff974a110d7`.
The funding-attestor configuration transaction is
`0x51fbf29599fbfe90ceead96518c80c87d58511b382c86b99251fdffd8ce68209`.

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

The 15-test Foundry suite includes the complete Base flow: identity-authorized funding,
reservation binding, nonce- and time-bound settlement, recipient accounting,
and pull claim. It also exercises index squatting, mismatched identities,
unauthorized binding, stale/conflicting/expired decisions, replay, and both
signature-free delayed recovery paths. It specifically proves creator-bound
bounty funding with slot reuse after orphan recovery, eligible-appellant-only
appeal funding, and late zero-bond binding after a recovered reservation whose
GenLayer attempt had already activated.

The appeal-integrity regressions prove that zero-bond appeals settle without a
deposit, positive-bond appeals cannot resolve after funding verification but
before binding attestation, unauthorized attestors cannot activate them,
partially activated and already-bound reservations expire and financially
reconcile safely without stranded bonds or permanent settlement deferral, and
a properly funded and Base-bound appeal pays the finalized recipient. Seven
backend tests reject missing, unbound, and mismatched collateral, defer while a
bound orphan exists, and resume after its explicit recovery.

The direct GenLayer tests demonstrate that arbitrary unfunded reservations do
not consume the funded-attempt cap and that only the configured funding
attestor can activate a reservation.

`genvm-lint lint` passes all three deterministic AST safety checks. The
linter's combined `check` command cannot currently retrieve the historical
pinned SDK tarball from its own artifact registry; that tool-distribution
failure is not hidden as a source failure. Executable semantics are covered by
the six passing offline `gltest.direct` cases and by the finalized StudioNet
deployment and transactions above.

## CI availability

The workflow contains dedicated Foundry, GenLayer, frontend, backend, and
dependency jobs. The appeal-expiry integrity implementation at commit
`253cab074045a9c1d07ea7ba182f8d38ac54322d` produced run
[`40706267538`](https://github.com/zoefunds/Proof-bounty/actions/runs/40706267538).
GitHub refused to start every runner with: `The job was not started because
your account is locked due to a billing issue.` Restore the repository owner's
GitHub billing status and rerun the workflow; no repository change can bypass
that account-level lock.
