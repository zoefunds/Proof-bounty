import assert from "node:assert/strict";
import test from "node:test";
import { APPEAL_FUNDING_GRACE_SECONDS, planAppealSettlement } from "./appeal-reconciliation.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const RECIPIENT = "0x0000000000000000000000000000000000001234";

test("zero-bond finalized appeal settles immediately without Base appeal funding", () => {
  assert.deepEqual(planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 0n, fundedBond: 0n,
    resolvedAt: 100, now: 101,
  }), { defer: false, appealRecipient: ZERO, fundingWaived: false });
});

test("positive-bond appeal finalized before funding waits then allocates a late deposit", () => {
  assert.equal(planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 0n,
    resolvedAt: 100, now: 100 + APPEAL_FUNDING_GRACE_SECONDS - 1,
  }).defer, true);
  assert.deepEqual(planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 20n,
    resolvedAt: 100, now: 100 + 60,
  }), { defer: false, appealRecipient: RECIPIENT, fundingWaived: false });
});

test("missing positive appeal bond cannot block core settlement forever", () => {
  assert.deepEqual(planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 0n,
    resolvedAt: 100, now: 100 + APPEAL_FUNDING_GRACE_SECONDS,
  }), { defer: false, appealRecipient: ZERO, fundingWaived: true });
});

test("mismatched funded appeal amount is never allocated", () => {
  assert.throws(() => planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 19n,
    resolvedAt: 100, now: 101,
  }), /does not match/);
});
