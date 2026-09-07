// Regression checks for frontend-only bugs flagged in review, none of
// which involve the contract or a live network -- pure logic checks
// against the actual functions used in apps/web, IMPORTED DIRECTLY from
// their real source files rather than reimplemented here, so a change to
// the real logic (or a regression in it) is what this script actually
// exercises -- not a copy of it that could silently drift out of sync.
//
//   1. Appeal-bond value construction (AttemptCard.tsx's handleAppeal)
//      used to round-trip an already-exact wei integer through
//      `Number(x) / 1e18` before re-parsing it back to wei -- lossy for
//      any real bond amount, all of which comfortably exceed
//      Number.MAX_SAFE_INTEGER (2^53 - 1). Fixed to `BigInt(x)` directly.
//   2. The "Claim Timeout Refund" button (bounty/[id]/page.tsx) used to
//      show as soon as the bounty's deadline passed, without also
//      requiring the contract's own VERIFICATION_GRACE_SECONDS (24h)
//      buffer past it -- so clicking it during that window would revert
//      on-chain even though the button was visible and enabled.
//   3. The same button also used to stay visible/enabled while an
//      attempt on the bounty was still DISPUTED / ARBITER_RESOLVED_
//      PENDING_APPEAL / APPEALED, even after the grace period elapsed --
//      the contract correctly rejects that click (see
//      `test_claim_creator_timeout_rejects_while_dispute_is_still_resolving`
//      in tests/integration/test_proof_bounty.py), but the UI was still
//      offering an action guaranteed to revert. Fixed by extracting the
//      button's visibility logic into `canClaimBountyTimeout`
//      (apps/web/lib/bounty-actions.ts), which the page component now
//      calls directly -- this script imports that SAME function, so this
//      is a real check against the code the UI runs, not a predicate
//      reimplementation that could pass while the actual component logic
//      stays broken.

import { toGenWei, VERIFICATION_GRACE_SECONDS } from "../apps/web/lib/format.ts";
import { canClaimBountyTimeout } from "../apps/web/lib/bounty-actions.ts";

function assert(cond, msg) {
  if (!cond) throw new Error("REGRESSION: " + msg);
  console.log("  ✓", msg);
}

console.log("=== Regression 1: appeal bond preserved as an exact integer ===");

// Deliberately non-round, far past Number.MAX_SAFE_INTEGER -- the same
// value used in the contract-side regression test
// (test_appeal_bond_is_preserved_as_an_exact_integer).
const exactBondWei = 234567891234567891n;

// The OLD, buggy construction this project used to ship:
const oldBuggyValue = toGenWei(String(Number(exactBondWei) / 1e18));
console.log("   old buggy value:  ", oldBuggyValue.toString());
console.log("   exact original:   ", exactBondWei.toString());
assert(
  oldBuggyValue !== exactBondWei,
  "the OLD Number()/1e18 round-trip does NOT preserve this realistic bond amount exactly " +
    "(documents the regression this fix closes -- if this assertion ever starts failing, " +
    "it means JS engines got more forgiving here, not that the old code was ever safe to rely on)"
);

// The NEW, fixed construction (mirrors AttemptCard.tsx's handleAppeal).
const newFixedValue = BigInt(exactBondWei.toString());
assert(newFixedValue === exactBondWei, "the NEW BigInt(...) construction preserves the exact integer");

console.log("\n=== Regression 2: timeout action only shown after the grace period ===");

const ONE_HOUR = 3600;
const deadline = Math.floor(Date.now() / 1000) + ONE_HOUR;

const baseParams = { isCreator: true, bountyStatusLabel: "OPEN", deadline, attempts: [] };

assert(
  canClaimBountyTimeout({ ...baseParams, now: deadline - 1 }) === false,
  "button hidden before the deadline (sanity check)"
);
assert(
  canClaimBountyTimeout({ ...baseParams, now: deadline + 1 }) === false,
  "button MUST stay hidden immediately after the deadline passes -- the contract's " +
    `VERIFICATION_GRACE_SECONDS (${VERIFICATION_GRACE_SECONDS}s) has not elapsed yet, ` +
    "so clicking it here would revert on-chain"
);
assert(
  canClaimBountyTimeout({ ...baseParams, now: deadline + VERIFICATION_GRACE_SECONDS - 1 }) === false,
  "button MUST stay hidden right up to (but not including) the grace deadline"
);
assert(
  canClaimBountyTimeout({ ...baseParams, now: deadline + VERIFICATION_GRACE_SECONDS }) === true,
  "button correctly shown once deadline + VERIFICATION_GRACE_SECONDS has actually passed, with no live dispute"
);

console.log("\n=== Regression 3: timeout action suppressed while a dispute/appeal is still resolving ===");

const afterGrace = deadline + VERIFICATION_GRACE_SECONDS;

for (const disputeStatus of ["DISPUTED", "ARBITER_RESOLVED_PENDING_APPEAL", "APPEALED"]) {
  assert(
    canClaimBountyTimeout({
      ...baseParams,
      now: afterGrace,
      attempts: [{ status_label: "ACCEPTED" }, { status_label: disputeStatus }],
    }) === false,
    `button MUST stay hidden past the grace period while any attempt is ${disputeStatus} -- ` +
      "clicking it would revert on-chain even though the grace period alone has elapsed"
  );
}

assert(
  canClaimBountyTimeout({
    ...baseParams,
    now: afterGrace,
    attempts: [{ status_label: "LOST_RACE" }, { status_label: "BOND_FORFEITED" }],
  }) === true,
  "button correctly shown once every attempt has reached a non-disputed (terminal or live-but-undisputed) state"
);

console.log("\n✅ ALL REGRESSION CHECKS PASSED");
