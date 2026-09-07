import { VERIFICATION_GRACE_SECONDS } from "./format.ts";
import type { AttemptDetail } from "./types.ts";

/**
 * Attempt states where a dispute/appeal is still actively resolving --
 * mirrors the contract's `_ATTEMPT_DISPUTE_IN_PROGRESS_STATES`
 * (contracts/proof_bounty.py). `claim_creator_timeout` rejects a reclaim
 * while any attempt on the bounty is in one of these, since a fresh
 * arbiter ruling or GenLayer consensus review might still award the
 * reward to that attempt's challenger.
 */
const DISPUTE_IN_PROGRESS_STATUSES = ["DISPUTED", "ARBITER_RESOLVED_PENDING_APPEAL", "APPEALED"];

/**
 * Whether the "Claim Timeout Refund" action should be offered right now.
 * Extracted as a standalone, importable function (rather than inlined in
 * the page component) specifically so it can be exercised directly by a
 * regression check against the REAL logic the UI runs, not a
 * reimplementation of it.
 *
 * Must stay in lockstep with `claim_creator_timeout`'s own preconditions
 * in contracts/proof_bounty.py: bounty still OPEN, deadline +
 * VERIFICATION_GRACE_SECONDS elapsed, and no attempt still mid-dispute --
 * offering the action when any of these don't hold means a click is
 * guaranteed to revert on-chain.
 *
 * `attempts` is `null`/`undefined` while `get_bounty_attempts` is still
 * loading (`useContractRead`'s `data` starts as `null`) or hasn't been
 * requested yet -- treated here as "unknown, not zero," so the action
 * stays hidden until the real list has actually arrived. Passing `[]`
 * for "still loading" would let the action render past the grace period
 * even when a live dispute exists but hasn't loaded yet.
 */
export function canClaimBountyTimeout(params: {
  isCreator: boolean;
  bountyStatusLabel: string;
  now: number;
  deadline: number;
  attempts: Pick<AttemptDetail, "status_label">[] | null | undefined;
}): boolean {
  const { isCreator, bountyStatusLabel, now, deadline, attempts } = params;
  if (attempts == null) return false;
  const graceElapsed = now >= deadline + VERIFICATION_GRACE_SECONDS;
  const hasDisputeInProgress = attempts.some((a) => DISPUTE_IN_PROGRESS_STATUSES.includes(a.status_label));
  return isCreator && bountyStatusLabel === "OPEN" && graceElapsed && !hasDisputeInProgress;
}
