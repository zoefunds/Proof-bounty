/**
 * Central contract integration config. `CONTRACT_ADDRESS` stays empty until
 * the project owner deploys `contracts/proof_bounty.py` to StudioNet
 * themselves and provides the address — never invent one here (see
 * memory/MEMORY.md, "Standing instructions from user"). Every UI surface
 * that needs the contract must check `isContractConfigured()` first and
 * render an explicit "not yet deployed" state instead of a silent failure.
 */

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS ?? "";

export const GENLAYER_CHAIN = {
  name: process.env.NEXT_PUBLIC_GENLAYER_NETWORK ?? "studionet",
  rpcUrl: process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api",
};

export function isContractConfigured(): boolean {
  return CONTRACT_ADDRESS.length > 0;
}

// Mirrors contracts/proof_bounty.py SECTION 1 status constants exactly —
// keep in sync with the contract if the contract's enums ever change.
export const BOUNTY_STATUS_LABELS: Record<number, string> = {
  0: "OPEN",
  1: "SETTLED",
  2: "CANCELLED",
  3: "EXPIRED_REFUNDED",
};

export const ATTEMPT_STATUS_LABELS: Record<number, string> = {
  0: "ACCEPTED",
  1: "SUBMITTED",
  2: "NEEDS_REVISION",
  3: "WON",
  4: "LOST_RACE",
  5: "REJECTED_FINAL",
  6: "BOND_FORFEITED",
  7: "DISPUTED",
  8: "CANCELLED",
  9: "ARBITER_RESOLVED_PENDING_APPEAL",
  10: "APPEALED",
  11: "INSUFFICIENT_EVIDENCE_FINAL",
};

export const VALID_CATEGORIES = [
  "SECURITY",
  "GOVERNANCE",
  "OPEN_SOURCE",
  "DOCUMENTATION",
  "PROTOCOL_RESEARCH",
  "ONCHAIN_ANALYSIS",
  "PRODUCT_CLAIMS",
  "PUBLIC_ACCOUNTABILITY",
  "OTHER",
] as const;

export type Category = (typeof VALID_CATEGORIES)[number];
