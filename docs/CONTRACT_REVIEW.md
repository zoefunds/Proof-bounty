# Contract security invariant map

## Funding and capacity

| Invariant | Enforcement | Verification |
|---|---|---|
| Another wallet cannot occupy a challenger's funding position | EIP-712 `FundAttempt` binds reservation and `msg.sender` | `testAttemptFundingIsIdentityBoundAndSquattingFails` |
| Another wallet cannot occupy a predictable bounty ID | EIP-712 `FundBounty` binds finalized creator and exact GenLayer terms | `testBountyFundingIsCreatorBoundAndSquattingFails` |
| Unfunded users cannot exhaust the 40-attempt cap | `reserve_attempt` stores outside attempts; cap applies in `confirm_attempt_funding` | `test_unfunded_reservations_do_not_consume_attempt_cap_is_a_safe_noop` |
| Only verified funding can activate an attempt | GenLayer checks `funding_attestor`; API verifies Base receipt/event first | `test_only_funding_attestor_can_activate_reservation_is_a_safe_noop` |
| Base and GenLayer use the exact finalized index | Activated reservation stores the index; `BindAttempt` signs it with the Base funding tx hash | end-to-end Foundry test |
| Criteria cannot move after economic commitment | `criteria_locked` is set on first funded activation | GenLayer reservation/activation tests |

## Settlement

| Invariant | Enforcement | Verification |
|---|---|---|
| A settlement cannot be replayed | single-use state hash, one-time reward/attempt flags | Foundry tampering and stale/conflict tests |
| Old or conflicting instructions cannot move funds | strictly increasing bounty nonce and validity window | `testStaleAndConflictingSettlementInstructionsFail` |
| A stolen relay key alone is insufficient | configured relayer caller plus decision-signer EIP-712 signature | `testInstructionTamperingAndWrongRelayerRejected` |
| Recipient identity cannot be substituted | winner/refund/forfeit recipient rules checked against funded ledgers | identity and end-to-end Foundry tests |
| Every USDC base unit is conserved | gross, fee, creator remainder, bond, and appeal allocations | `testPartialWinnerConservesEveryUsdcUnit` |
| Users pull funds safely | claimable zeroed before token transfer under reentrancy guard | end-to-end recipient claim test |

## Recovery

| Invariant | Enforcement | Verification |
|---|---|---|
| Relay outage cannot permanently trap an unbound bond | challenger recovery after authorization expiry + 24 hours, no signature | `testUnboundAttemptRecoveryNeedsNoPrivilegedSignature` |
| Registration outage/mismatch cannot permanently trap a reward or block its ID forever | creator recovery after seven days credits the refund and deletes the slot | `testOrphanRecoveryRequiresDelayButNoPrivilegedSignature` |
| Recovery after GenLayer activation cannot strand the winner | recovered reservation remains bindable with bond zeroed to prevent double payment | `testActivatedAttemptCanBindAfterRecoveryWithoutDoubleBond` |
| Third parties cannot occupy an appeal-bond slot | EIP-712 `FundAppeal` binds finalized appellant, attempt, bond, contract, and expiry | `testAppealFundingRequiresEligibleAppellantAuthorization` |
| Positive-bond appeals cannot bypass collateral | GenLayer keeps them pending until attestor-verified Base funding is bound; `resolve_appeal` rejects beforehand | GenLayer attestation and backend reconciliation tests |
| Failed appeal funding cannot freeze settlement | pending funding expires after two hours; unactivated Base deposits have payer-only delayed recovery | GenLayer expiry and Foundry recovery tests |
| Frontend can resume partial completion | local reservation/tx persistence and idempotent confirmation | production bounty action flow |

## Adjudication

- Validators retrieve evidence themselves with `gl.nondet.web.render`.
- Consensus compares structured verdict and bucketed payout fields.
- The challenger description is not substituted for fetched evidence.
- An arbiter ruling is advisory; explicit appeal or post-window finalization
  runs a second GenLayer consensus round.
- Timeout recovery rejects while a dispute or appeal is live.
- The backend cannot change GenLayer verdict state other than the narrow
  funding-attestation activation method.

## Explicit trust boundary

Base does not verify a GenLayer proof. A compromised service host containing
both relayer and decision-signer credentials can authorize a false settlement.
Nonce, expiry, identity, and accounting controls limit mistakes and partial-key
compromise but do not remove this oracle trust. Mainnet requires independent or
threshold signer infrastructure.

## Reproduction

Run the commands in [VERIFICATION.md](VERIFICATION.md). GitHub Actions includes
the same major jobs but is currently prevented from starting them by the
repository owner's billing lock.
