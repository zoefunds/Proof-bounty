const ZERO = "0x0000000000000000000000000000000000000000";

export type AppealSettlementPlan = {
  defer: boolean;
  appealRecipient: string;
  fundingWaived: boolean;
};

/**
 * Reconcile finalized GenLayer appeal state with Base custody.
 *
 * Zero-bond appeals never need a Base deposit. A finalized positive-bond
 * appeal is only reachable after GenLayer attestation and Base binding. A
 * missing or unbound bond is an integrity error unless Base records that the
 * payer completed the explicit delayed orphan-recovery path.
 */
export function planAppealSettlement(input: {
  finalizedRecipient: string;
  requiredBond: bigint;
  fundedBond: bigint;
  appealBound: boolean;
  appealRecovered: boolean;
}): AppealSettlementPlan {
  const recipient = input.finalizedRecipient.toLowerCase();
  if (recipient === ZERO) {
    if (input.fundedBond !== 0n) return { defer: true, appealRecipient: ZERO, fundingWaived: false };
    return { defer: false, appealRecipient: ZERO, fundingWaived: false };
  }
  if (input.requiredBond === 0n) {
    if (input.fundedBond !== 0n) throw new Error("zero-bond appeal unexpectedly holds Base funds");
    return { defer: false, appealRecipient: ZERO, fundingWaived: false };
  }
  if (input.fundedBond !== 0n) {
    if (input.fundedBond !== input.requiredBond) throw new Error("Base appeal bond does not match bounty terms");
    if (!input.appealBound) throw new Error("Base appeal bond was not activated by GenLayer attestation");
    return { defer: false, appealRecipient: input.finalizedRecipient, fundingWaived: false };
  }
  if (input.appealRecovered) return { defer: false, appealRecipient: ZERO, fundingWaived: true };
  throw new Error("finalized positive-bond appeal has no verified Base collateral");
}
