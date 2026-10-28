export const APPEAL_FUNDING_GRACE_SECONDS = 7 * 24 * 60 * 60;

const ZERO = "0x0000000000000000000000000000000000000000";

export type AppealSettlementPlan = {
  defer: boolean;
  appealRecipient: string;
  fundingWaived: boolean;
};

/**
 * Reconcile finalized GenLayer appeal state with Base custody.
 *
 * Zero-bond appeals never need a Base deposit. Positive-bond appeals get a
 * bounded window for the finalized appellant to fund late. If that window
 * expires, the nonexistent appeal bond is explicitly waived and core reward /
 * attempt settlement proceeds; no contract balance is fabricated or diverted.
 */
export function planAppealSettlement(input: {
  finalizedRecipient: string;
  requiredBond: bigint;
  fundedBond: bigint;
  resolvedAt: number;
  now: number;
}): AppealSettlementPlan {
  const recipient = input.finalizedRecipient.toLowerCase();
  if (recipient === ZERO) {
    if (input.fundedBond !== 0n) throw new Error("Base appeal bond exists without a finalized GenLayer recipient");
    return { defer: false, appealRecipient: ZERO, fundingWaived: false };
  }
  if (input.requiredBond === 0n) {
    if (input.fundedBond !== 0n) throw new Error("zero-bond appeal unexpectedly holds Base funds");
    return { defer: false, appealRecipient: ZERO, fundingWaived: false };
  }
  if (input.fundedBond !== 0n) {
    if (input.fundedBond !== input.requiredBond) throw new Error("Base appeal bond does not match bounty terms");
    return { defer: false, appealRecipient: input.finalizedRecipient, fundingWaived: false };
  }
  const deadline = input.resolvedAt + APPEAL_FUNDING_GRACE_SECONDS;
  if (input.resolvedAt > 0 && input.now < deadline) {
    return { defer: true, appealRecipient: ZERO, fundingWaived: false };
  }
  return { defer: false, appealRecipient: ZERO, fundingWaived: true };
}
