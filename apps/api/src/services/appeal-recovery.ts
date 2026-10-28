import { getAddress } from "ethers";

const ZERO = "0x0000000000000000000000000000000000000000";

export type AppealRecoveryState = {
  status_label: string;
  appealed_by: string;
  appeal_bond_deposited: number;
  appeal_bond_recipient: string;
  appeal_funding_deadline: number;
  appeal_base_funding_tx_hash: string;
};

/**
 * Bound collateral is recoverable only when finalized GenLayer state carries
 * the exact metadata retained by expire_appeal_funding(): a zero declared
 * bond, the original appellant and funding transaction, and no appeal-bond
 * recipient. Active and resolved appeals retain their positive declared bond
 * and therefore can never receive a recovery authorization.
 */
export function assertBoundAppealRecoveryEligible(input: {
  fresh: AppealRecoveryState;
  appellant: string;
  baseFundingTxHash: string;
  now: number;
}) {
  const { fresh } = input;
  if (getAddress(fresh.appealed_by) !== getAddress(input.appellant)) throw new Error("caller is not the finalized GenLayer appellant");
  if (!fresh.appeal_base_funding_tx_hash || fresh.appeal_base_funding_tx_hash.toLowerCase() !== input.baseFundingTxHash.toLowerCase()) throw new Error("Base appeal funding transaction does not match finalized GenLayer state");
  if (fresh.appeal_funding_deadline <= 0 || input.now <= fresh.appeal_funding_deadline) throw new Error("GenLayer appeal funding reservation has not expired");
  if (fresh.appeal_bond_deposited !== 0) throw new Error("active or finalized GenLayer appeal collateral cannot be recovered");
  if (fresh.appeal_bond_recipient.toLowerCase() !== ZERO) throw new Error("finalized appeal collateral has a recipient and cannot be recovered");
  if (["APPEAL_PENDING_FUNDING", "APPEAL_FUNDED_PENDING_BINDING", "APPEALED"].includes(fresh.status_label)) throw new Error("GenLayer appeal is still active");
}
