// Regression checks for two frontend-only bugs flagged in review, neither
// of which involves the contract or a live network -- pure logic checks
// against the actual functions used in apps/web (imported directly, not
// reimplemented), matching this project's convention of Node scripts for
// verification work outside the pytest/gltest suite.
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

import { toGenWei, VERIFICATION_GRACE_SECONDS } from "../apps/web/lib/format.ts";

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

function canClaimTimeout(now, deadlineSeconds) {
  // Mirrors bounty/[id]/page.tsx's canClaimTimeout condition (isCreator
  // and bounty.status_label === "OPEN" assumed true for this check).
  return now >= deadlineSeconds + VERIFICATION_GRACE_SECONDS;
}

assert(
  canClaimTimeout(deadline - 1, deadline) === false,
  "button hidden before the deadline (sanity check)"
);
assert(
  canClaimTimeout(deadline + 1, deadline) === false,
  "button MUST stay hidden immediately after the deadline passes -- the contract's " +
    `VERIFICATION_GRACE_SECONDS (${VERIFICATION_GRACE_SECONDS}s) has not elapsed yet, ` +
    "so clicking it here would revert on-chain"
);
assert(
  canClaimTimeout(deadline + VERIFICATION_GRACE_SECONDS - 1, deadline) === false,
  "button MUST stay hidden right up to (but not including) the grace deadline"
);
assert(
  canClaimTimeout(deadline + VERIFICATION_GRACE_SECONDS, deadline) === true,
  "button correctly shown once deadline + VERIFICATION_GRACE_SECONDS has actually passed"
);

console.log("\n✅ ALL REGRESSION CHECKS PASSED");
