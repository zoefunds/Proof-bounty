import assert from "node:assert/strict";
import test from "node:test";
import { assertBoundAppealRecoveryEligible, type AppealRecoveryState } from "./appeal-recovery.js";

const APPELLANT = "0x0000000000000000000000000000000000001234";
const COUNTERPARTY = "0x0000000000000000000000000000000000005678";
const ZERO = "0x0000000000000000000000000000000000000000";
const TX = `0x${"ab".repeat(32)}`;

function state(overrides: Partial<AppealRecoveryState> = {}): AppealRecoveryState {
  return {
    status_label: "ARBITER_RESOLVED_PENDING_APPEAL",
    appealed_by: APPELLANT,
    appeal_bond_deposited: 0,
    appeal_bond_recipient: ZERO,
    appeal_funding_deadline: 1_000,
    appeal_base_funding_tx_hash: TX,
    ...overrides,
  };
}

test("expired abandoned binding is eligible for state-authorized recovery", () => {
  assert.doesNotThrow(() => assertBoundAppealRecoveryEligible({ fresh: state(), appellant: APPELLANT, baseFundingTxHash: TX, now: 1_001 }));
});

test("successfully activated appeal cannot receive recovery authorization", () => {
  assert.throws(() => assertBoundAppealRecoveryEligible({ fresh: state({ status_label: "APPEALED", appeal_bond_deposited: 20 }), appellant: APPELLANT, baseFundingTxHash: TX, now: 9_999 }), /cannot be recovered/);
});

test("adversely finalized appeal cannot receive recovery authorization", () => {
  assert.throws(() => assertBoundAppealRecoveryEligible({ fresh: state({ status_label: "BOND_FORFEITED", appeal_bond_deposited: 20, appeal_bond_recipient: COUNTERPARTY }), appellant: APPELLANT, baseFundingTxHash: TX, now: 9_999 }), /cannot be recovered/);
});

test("mismatched funding transaction cannot receive recovery authorization", () => {
  assert.throws(() => assertBoundAppealRecoveryEligible({ fresh: state(), appellant: APPELLANT, baseFundingTxHash: `0x${"cd".repeat(32)}`, now: 1_001 }), /does not match/);
});
