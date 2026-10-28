# Milestone verification record

Verified on 2026-10-28 against commit contents in this release.

The current pair was deployed fresh so its bounty-ID namespace cannot collide
with positions registered by the preceding GenLayer contract. The derived
Postgres index/cache was cleared after the cutover. Two detailed production
fixtures were then created and funded; live health reports
`lastBountyCount: 2`, `cachedBounties: 2`, and no indexer error.

## Deployed components

- GenLayer adjudication: `0x043b97cB152Bf930017d48aD05FA631004c7158f`
- Base Sepolia escrow: `0xF93548faf36D2d613A41f3e6A85D9C98bFF50dEf`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Frontend: <https://proof-bounty.vercel.app>
- API/relay: <https://proofbounty-usdc-api.fly.dev>

The Base deployment transaction is
`0x0c39a9f387c27196938738feb933113d32de2d68c5546b43196b2f1e8c33489f`.
The GenLayer deployment transaction is
`0xef7b49542e7c7b2284ce45f1b927b24d438b3b1a891eb6ae95a7b5520b225165`.
The funding-attestor configuration transaction is
`0x24bfc849c00f8a96153e34fdfbcc7432b358382c26c5f17a05c402ae7bd1a177`.

Live reads on the current deployment report GenLayer bounty count `2`, contract
balance `0`, and default fee `250`. Base getters resolve to the USDC, owner,
relayer, decision signer, and treasury documented for this release; GenLayer
reports the documented funding attestor. The production API
reports `lastBountyCount: 2`, `cachedBounties: 2`, and no indexer error. Prior
deployment records are intentionally retained only in Git history so they
cannot be mistaken for current operational data.

The two current Base positions are registered and hold 12 USDC in aggregate:

| Bounty | Reward | Bond | Base funding transaction |
|---:|---:|---:|---|
| 0 | 5 USDC | 1 USDC | `0x1026328070dd414bd15592edf58ff0f58d688bdc48582fd0d168c6002e9ead4b` |
| 1 | 7 USDC | 1.5 USDC | `0xf06bfa22a634fafe64e48621d1b37575e3a2eb5c189b2111889934e7028dc798` |

The current API is Fly release `v23` (`3Ao2wbV00g5oQUD2p9Y0ZBq2X`). The
current frontend deployment is Vercel deployment
`dpl_3SNYVbwQHuGi7b1vAnM4upgT531C` and serves the canonical production alias.
The complete route-by-route production exercise is in
[E2E-TESTS.md](E2E-TESTS.md).

## Reproducible checks

```bash
forge test -vv
genvm-lint lint contracts/proof_bounty.py --json
gltest tests/integration -v -s -k "is_a_safe_noop or human_override"
(cd apps/api && npm ci && npm test && npx tsc --noEmit && npx prisma generate && npm run build)
(cd apps/web && npm ci && npm run lint && npx tsc --noEmit && npx next build --webpack)
```

The 16-test Foundry suite includes the complete Base flow: identity-authorized funding,
reservation binding, nonce- and time-bound settlement, recipient accounting,
and pull claim. It also exercises index squatting, mismatched identities,
unauthorized binding, stale/conflicting/expired decisions, replay, and the
signature-free creator/unbound recovery paths. It specifically proves creator-bound
bounty funding with slot reuse after orphan recovery, eligible-appellant-only
appeal funding, and late zero-bond binding after a recovered reservation whose
GenLayer attempt had already activated.

The appeal-integrity regressions prove that zero-bond appeals settle without a
deposit, positive-bond appeals cannot resolve after funding verification but
before binding attestation, unauthorized attestors cannot activate them,
partially activated and already-bound reservations expire and financially
reconcile safely without stranded bonds or permanent settlement deferral, and
a properly funded and Base-bound appeal pays the finalized recipient. The
regressions also reject recovery for active and adversely finalized appeals and
prove that an adverse outcome still allocates the appeal bond. Twelve backend
tests cover state eligibility and settlement reconciliation, including deferral
while a bound orphan exists and resumption after authorized recovery.

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
dependency jobs. The active-appeal bond-integrity implementation at commit
`48f1b36c760a82918bb92fface7dc02879c90e0c` produced run
[`40710610247`](https://github.com/zoefunds/Proof-bounty/actions/runs/40710610247).
GitHub refused to start every runner with: `The job was not started because
your account is locked due to a billing issue.` Restore the repository owner's
GitHub billing status and rerun the workflow; no repository change can bypass
that account-level lock.
