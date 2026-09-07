# Contract review: invariants, code, and proof

A short map from "what this contract claims to guarantee" to "the exact
code that enforces it" and "the exact test that proves it." Written for
a reviewer who wants to verify a specific claim quickly rather than read
2,700+ lines end to end.

All line numbers refer to `contracts/proof_bounty.py`. All tests are in
`tests/integration/test_proof_bounty.py` unless noted; run with:

```bash
gltest tests/integration -v -s -m "not llm" --network studionet --chain-type studionet
```

## Escrow correctness

| Invariant | Code | Proof |
|---|---|---|
| `create_bounty`/`accept_bounty` require the sent value to *exactly* match the reward/bond — never "at least" | `create_bounty` (reward check), `accept_bounty` (bond check) | `test_accept_bounty_rejects_wrong_bond_amount` |
| Every payout path reads the ledger, zeroes it, persists status, *then* transfers — never the reverse | `_settle_reward_to_winner`, `_forfeit_attempt_bond`, `_refund_attempt_bond`, `_send_gen` (the single choke point all value transfers go through) | Structural — every settlement test (`test_request_verification_full_lifecycle`, `test_human_override_*`) exercises this path; `_send_gen` itself rejects non-positive amounts |
| Zero-bond bounties reach the same terminal states as bonded ones (no forced revert on a zero balance) | `_refund_attempt_bond`/`_forfeit_attempt_bond`'s status-transition-independent-of-transfer design | `test_zero_bond_reclaim_after_settlement_is_a_safe_noop` |
| `MAX_ATTEMPTS_PER_BOUNTY` bounds the settlement-loop cost so a flood of low/zero-bond attempts can't deny the eventual winner their payout | `MAX_ATTEMPTS_PER_BOUNTY = 40`, enforced in `accept_bounty`, consumed by `_mark_other_attempts_lost_race` | `test_max_attempts_per_bounty_cap_enforced` (41 real transactions, cap enforced at exactly 40) |
| Criteria/claim/evidence-requirements become permanently immutable on the first accepted attempt | `Bounty.criteria_locked`, set in `accept_bounty` | `test_accept_bounty_locks_criteria_and_bond` |

## GenLayer consensus is what decides, not a summary or a backend

| Invariant | Code | Proof |
|---|---|---|
| The contract fetches evidence itself; the challenger's own description is never judged | `_collect_verdict`'s `run_review()` closure — passes `page_text` (the fetched content) to the LLM prompt, never `evidence_description` | `test_request_verification_full_lifecycle` (live web fetch + live LLM consensus, `@pytest.mark.llm`); `scripts/03-happy-path-race.mjs` and `scripts/11`–`13` (live, real evidence URLs) |
| Every independent validator's judgment must agree for consensus to succeed | `gl.eq_principle.prompt_comparative` call in `_collect_verdict`, with an explicit principle string naming exactly which fields must match (`verdict`, bucketed `payout_bps`) and which are exempt (`reasoning`, `content_hash`) | Live-network tests above; the module docstring's "AVOIDING UNDETERMINED / LEADER-ROTATION OUTCOMES" section explains why each exemption exists |
| A PARTIAL payout is rounded onto a discrete grid *before* the consensus comparison, so the number compared is the number paid | `_bucket_payout_bps` (called inside the `run_nondet` closure, before the `eq_principle` call returns) | `test_request_verification_full_lifecycle` when a PARTIAL verdict lands; `scripts/10-product-test-a-settlement-race.mjs` (real PARTIAL settlement observed live) |
| A malformed/unparseable LLM response degrades deterministically (`NEEDS_REVISION`) instead of crashing or diverging per-validator | `_collect_verdict`'s outer `json.loads` + `if verdict not in _VALID_VERDICTS` fallback | Structural (every validator hitting the same malformed response reaches the same fallback, which is what keeps `eq_principle` from UNDETERMINING on a formatting accident) — not independently unit-tested against a live network, since forcing a real model to emit malformed JSON on demand isn't controllable; see the "Known gaps" section below |
| A dead/unreachable evidence URL degrades to `NEEDS_REVISION`, not a crash | `_collect_verdict`'s `try/except` around `gl.nondet.web.render` | `scripts/11-product-test-b-rejected-forfeiture.mjs` hit this live (a 403 response) and observed the clean `NEEDS_REVISION` degrade |

## Five-verdict outcome mapping

| Invariant | Code | Proof |
|---|---|---|
| `APPROVED`/`PARTIAL` pay the reward and mark every other live attempt `LOST_RACE` | `request_verification`'s `verdict in (VERDICT_APPROVED, VERDICT_PARTIAL)` branch + `_mark_other_attempts_lost_race` | `test_request_verification_full_lifecycle`; `scripts/10` (real 2-challenger race, real settlement) |
| `REJECTED` requires an explicit, separate `claim_bond_forfeiture` call — never auto-forfeits — so a wrongly-rejected challenger has a real window to dispute first | `claim_bond_forfeiture`'s docstring and precondition (`attempt.status != ATTEMPT_REJECTED_FINAL`) | `scripts/11-product-test-b-rejected-forfeiture.mjs` (real REJECTED_FINAL → real forfeiture) |
| `NEEDS_REVISION` grants a bounded number of resubmission cycles (`max_revisions`, default 3) before becoming `REJECTED_FINAL` | `request_verification`'s `VERDICT_NEEDS_REVISION` branch | `scripts/12-product-test-c-dispute-appeal.mjs` (real NEEDS_REVISION cycle observed live) |
| `INSUFFICIENT_EVIDENCE` is a distinct outcome from `REJECTED`: exhausting its resubmission cycle *refunds* the bond instead of forfeiting it, and does not penalize reputation | `request_verification`'s `VERDICT_INSUFFICIENT_EVIDENCE` branch, `ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL` | The verdict and refund behavior observed live in `scripts/10-product-test-a-settlement-race.mjs`'s and `resolve_appeal`'s equivalent `ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL` branch (same outcome shape) exercised by `test_resolve_appeal_is_decided_by_genlayer_consensus_not_a_human` |

## The arbiter/appeal tier is bounded, not routine

This is the section most relevant to whether GenLayer consensus, and not
a human, is what actually decides a payout. See also
`contracts/proof_bounty.py`'s "ARBITER TRUST MODEL AND THE APPEAL PATH"
module-docstring section, and the README's "Why this needs GenLayer"
section.

| Invariant | Code | Proof |
|---|---|---|
| A human ruling can **never** touch a reward AI consensus has already paid | `raise_dispute`'s precondition (`attempt.status not in _ATTEMPT_LIVE_STATES` → reject); `ATTEMPT_WON` is absent from `_ATTEMPT_LIVE_STATES` | Structural — there is no code path from `ATTEMPT_WON` back into any dispute/arbiter/appeal method; `test_raise_dispute_rejects_empty_reason` and friends exercise the surrounding access checks |
| The arbiter's ruling never has the final word, appealed or not — both exits off a disputed attempt always escalate to a second, independent round of GenLayer consensus, never to a human's judgment | `resolve_appeal` and `finalize_arbiter_resolution` are both fully permissionless (no `_require_owner`/`_require_arbiter` gate) and both settle through the shared `_settle_via_second_consensus`, decided by `_collect_appeal_verdict`, a real `gl.nondet.web.render` + `gl.eq_principle.prompt_comparative` round, never a human-supplied verdict executed directly | `test_resolve_appeal_is_decided_by_genlayer_consensus_not_a_human` (`@pytest.mark.llm`, real web fetch + real LLM consensus, called by the challenger themselves — no owner key anywhere in the test); `test_finalize_never_trusts_arbiter_even_when_unappealed_and_no_prior_ai_verdict` (mocked fresh consensus deliberately disagrees with an unappealed arbiter's ruling and its verdict is what settles the attempt, not the arbiter's); live via `scripts/09-appeal-flow.mjs` and `scripts/12-product-test-c-dispute-appeal.mjs` |
| `resolve_dispute` rejects a bare verdict with no written justification | `resolution_note` non-empty check | `test_resolve_dispute_rejects_empty_resolution_note` |
| An arbiter's ruling never moves money at all — it opens a 2-day appeal window; once that window closes (if nobody appealed), a separate, permissionless `finalize_arbiter_resolution` call runs its own fresh GenLayer consensus round and settles on that, never on the stored ruling | `resolve_dispute` sets `ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL` + `appeal_deadline`; `finalize_arbiter_resolution`'s `self._now() < appeal_deadline` guard, then `_settle_via_second_consensus` | `test_zero_bond_reclaim_after_settlement_rejects_before_appeal_window` (finalize correctly rejected before the window closes); `test_zero_bond_reclaim_after_settlement_is_a_safe_noop` (finalize correctly succeeds after, via `gltest.direct`'s time-warp + mocked fresh consensus) |
| Whether an arbiter's ruling ever diverges from GenLayer consensus is computed and recorded per-attempt, not asserted — but that divergence is informational only and never itself a settlement trigger, so it does not feed the transparency counters | `_human_verdict_matches_ai_outcome`, `Attempt.human_verdict_overrode_ai` (set in `resolve_dispute`); `_record_settlement_provenance` (no `via_human_ruling` parameter anymore — every call site unconditionally increments `attempts_settled_by_ai_consensus`) | `test_finalize_never_trusts_arbiter_even_when_unappealed_and_no_prior_ai_verdict`, `test_human_override_not_flagged_when_arbiter_agrees_with_ai_verdict` |
| The real, contract-wide fact that every settled attempt was decided by GenLayer consensus, never by a human ruling alone, is an always-queryable on-chain fact | `attempts_settled_by_ai_consensus` (increments unconditionally on every settlement), `attempts_settled_by_human_override` (retained for API/schema continuity, structurally guaranteed to always read zero — no code path increments it), `get_settlement_transparency()` | `test_finalize_never_trusts_arbiter_even_when_unappealed_and_no_prior_ai_verdict` asserts both counters directly, including in the single most human-favorable case (unappealed, no prior AI verdict); `test_resolve_appeal_is_decided_by_genlayer_consensus_not_a_human` asserts the same for the appealed path |
| `resolve_appeal` has NO access gate at all — anyone may call it once an attempt is `APPEALED` | Absence of any `_require_*` call in `resolve_appeal` | `test_resolve_appeal_rejects_when_not_appealed` (a stranger's call correctly rejects, but for state-machine reasons, not access control); `test_resolve_appeal_is_decided_by_genlayer_consensus_not_a_human` (a non-owner, non-arbiter party's call succeeds) |
| The owner can never move a single bounty's escrowed funds — only non-monetary admin functions (fee, treasury, pause) | `owner: Address` field docstring | N/A — documentation correctness; an earlier revision routed the final appeal tier through the owner, which was replaced specifically to remove this |

## Timeout recovery cannot race a live dispute; reputation counts are exact

| Invariant | Code | Proof |
|---|---|---|
| A creator can never reclaim an expired reward while a dispute/appeal on that bounty is still actively resolving, even past `VERIFICATION_GRACE_SECONDS` | `_ATTEMPT_DISPUTE_IN_PROGRESS_STATES` (DISPUTED, ARBITER_RESOLVED_PENDING_APPEAL, APPEALED), checked in `claim_creator_timeout` via a bounded scan of the bounty's attempts | `test_claim_creator_timeout_rejects_while_dispute_is_still_resolving` — proves the reward stays locked mid-dispute AND unlocks correctly once that same dispute resolves to a non-winning outcome |
| An appeal bond posted via `appeal_arbiter_resolution` must exactly equal `attempt.bond_amount` — off by even one wei is rejected, and the accepted amount is stored back unchanged | `appeal_arbiter_resolution`'s `int(sent) != int(attempt.bond_amount)` exact-match check | `test_appeal_bond_is_preserved_as_an_exact_integer` (off-by-one-wei rejected in both directions on a deliberately non-round bond amount, exact amount preserved — ran live against real StudioNet). The frontend's OWN construction of this value was a separate, real bug (a lossy `Number()`/1e18 round-trip on an already-exact wei integer) fixed to `BigInt(attempt.bond_amount)` directly — see `memory/MEMORY.md`'s "Team review" section and `scripts/14-regression-appeal-bond-and-timeout.mjs` |
| A challenger's `attempts_rejected` reputation strike is charged EXACTLY ONCE per attempt, no matter how many rejection-adjacent transitions that attempt passes through (a direct REJECTED verdict later forfeited, or a dispute that re-confirms rejection) | `Attempt.rejection_counted`, guarding all three increment sites (`request_verification`'s two rejection branches, `_forfeit_attempt_bond`) | `test_attempts_rejected_is_not_double_counted_across_reject_then_forfeit` — confirmed to genuinely catch the bug (reverting the fix makes the test fail); this was a real double-count bug found live (a real attempt read `attempts_rejected: 2` for itself with zero retries involved, ruling out a testing artifact) |

## Provenance

| Invariant | Code | Proof |
|---|---|---|
| Every successful verification stamps a fingerprint of the exact fetched-and-judged content | `_content_digest`, `Attempt.evidence_content_hash`/`evidence_fetched_at`, set in `request_verification` | `scripts/10` (real `evidence_content_hash` observed on a live settled attempt) |
| The fingerprint is explicitly documented as NOT proof of what any individual validator's fetch saw byte-for-byte, and NOT an archive | `_content_digest`'s docstring, module docstring's "EVIDENCE MANIFEST" section | N/A — documentation correctness |
| An independent, off-chain, SSRF-hardened archive cross-checks its own digest against the on-chain one and records match/mismatch as an observable fact, not a claimed guarantee | `apps/api/src/services/evidence-archiver.ts` (`contentDigestFnv1a`, `onChainHashMatch`) | See `docs/SECURITY.md` §5; surfaced live in the frontend's `AttemptCard` "Independent off-chain archive" panel |

## Access control

| Invariant | Code | Proof |
|---|---|---|
| Only the bounty creator may cancel, extend the deadline, or claim a forfeited bond | `_require_creator` | `test_cancel_bounty_rejects_after_criteria_locked` and structural checks throughout |
| Only the bounty's named arbiter may `resolve_dispute` | `_require_arbiter` | `test_resolve_dispute_rejects_non_arbiter` |
| Only the creator or the challenger may raise a dispute or appeal | `_require_creator_or_challenger` | `test_appeal_arbiter_resolution_rejects_stranger` |
| Only the protocol owner may pause the protocol or change the fee/treasury | `_require_owner` | `test_admin_update_fee_rejects_non_owner` |
| `resolve_appeal` has no access gate whatsoever — this is deliberate, not an oversight | Absence of `_require_owner`/`_require_arbiter`/`_require_creator_or_challenger` in `resolve_appeal` | `test_resolve_appeal_is_decided_by_genlayer_consensus_not_a_human` |

## Known gaps (honest, not silently left out)

- **Full adversarial fuzzing** (fabricated/contradictory evidence content shaped to specifically probe LLM judgment boundaries, malformed-LLM-output forced on demand, reentrancy-shaped repeated-call sequences beyond the ones already covered by the zero-bond/double-claim tests) is not exhaustively automated. The zero-then-transfer discipline and the explicit status-guard on every write method are the structural defenses; `test_appeal_arbiter_resolution_success_reaches_appealed_status`'s double-appeal-rejected assertion and `claim_bond_forfeiture`'s existing double-claim test are the closest direct proof of "can't settle the same attempt twice."
- **A full real-browser-wallet end-to-end test** has been manually verified by the project owner against the live production frontend (wallet connect, contract calls, and on-chain tx status updates all confirmed working) — but not yet automated (no CI-driven, screenshot-captured MetaMask/WalletConnect popup approval flow exists). The transaction-lifecycle state machine (`lib/use-contract-write.ts`) is separately exercised by every write path described above through direct contract calls, not through a driven browser session.
- **CI** runs `genvm-lint`, the offline/direct-mode subset of the test suite, and frontend/backend lint+typecheck+build on every push (see `.github/workflows/`). It does not run the live-StudioNet subset of tests (would require committing real signing keys to CI secrets, which this project does not do) — those remain a manual, documented step (`scripts/00-reviewer-verify.mjs`).
