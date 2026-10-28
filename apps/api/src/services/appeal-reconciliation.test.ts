import assert from "node:assert/strict";
import test from "node:test";
import { planAppealSettlement } from "./appeal-reconciliation.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const RECIPIENT = "0x0000000000000000000000000000000000001234";

test("zero-bond finalized appeal settles immediately without Base appeal funding", () => {
  assert.deepEqual(planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 0n, fundedBond: 0n,
    appealBound: false,
  }), { defer: false, appealRecipient: ZERO, fundingWaived: false });
});

test("properly attested positive-bond appeal allocates its deposit", () => {
  assert.deepEqual(planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 20n,
    appealBound: true,
  }), { defer: false, appealRecipient: RECIPIENT, fundingWaived: false });
});

test("unfunded positive appeal can never obtain a settlement allocation", () => {
  assert.throws(() => planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 0n,
    appealBound: false,
  }), /no verified Base collateral/);
});

test("unbound positive appeal deposit can never obtain a settlement allocation", () => {
  assert.throws(() => planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 20n,
    appealBound: false,
  }), /not activated/);
});

test("mismatched funded appeal amount is never allocated", () => {
  assert.throws(() => planAppealSettlement({
    finalizedRecipient: RECIPIENT, requiredBond: 20n, fundedBond: 19n,
    appealBound: true,
  }), /does not match/);
});
