import { createClient, chains } from "genlayer-js";

export const CONTRACT_ADDRESS = "0x9EAe7903e7489478C53a48Ab06D57d5aFb3eE3F1";

// Verified against genlayer-js's own bundled enum
// (node_modules/genlayer-js/dist/chunk-EY35NPSE.js, transactionsStatusNumberToName)
// rather than assumed.
const STATUS_NUMBER_TO_NAME = {
  0: "UNINITIALIZED",
  1: "PENDING",
  2: "PROPOSING",
  3: "COMMITTING",
  4: "REVEALING",
  5: "ACCEPTED",
  6: "UNDETERMINED",
  7: "FINALIZED",
  8: "CANCELED",
  9: "APPEAL_REVEALING",
  10: "APPEAL_COMMITTING",
  11: "READY_TO_FINALIZE",
  12: "VALIDATORS_TIMEOUT",
  13: "LEADER_TIMEOUT",
};

// "Decided, non-error" outcomes -- ACCEPTED means validator consensus was
// reached (the transaction executed and its result was agreed on); it
// later becomes FINALIZED after the finality window elapses. Neither is
// an error. UNDETERMINED, CANCELED, VALIDATORS_TIMEOUT, LEADER_TIMEOUT are
// all real failure/error states we explicitly want to catch and report,
// never silently treat as success.
const SUCCESS_STATUSES = new Set(["ACCEPTED", "FINALIZED"]);
const ERROR_STATUSES = new Set(["UNDETERMINED", "CANCELED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"]);

export function clientFor(account) {
  return createClient({ chain: chains.studionet, account });
}

export const readOnlyClient = createClient({ chain: chains.studionet });

export async function read(functionName, args = []) {
  return readOnlyClient.readContract({ address: CONTRACT_ADDRESS, functionName, args });
}

export async function write(client, functionName, args = [], value = 0n) {
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value,
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    retries: 120,
    interval: 3000,
  });
  return { hash, receipt };
}

export function statusName(receipt) {
  const raw = receipt?.status;
  if (typeof raw === "number") return STATUS_NUMBER_TO_NAME[raw] ?? `UNKNOWN(${raw})`;
  if (typeof raw === "string" && STATUS_NUMBER_TO_NAME[Number(raw)]) {
    return STATUS_NUMBER_TO_NAME[Number(raw)];
  }
  return String(raw ?? receipt?.statusName ?? "UNKNOWN");
}

export function leaderExecutionResult(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.execution_result ?? null;
}

export function receiptSucceeded(receipt) {
  const name = statusName(receipt);
  if (ERROR_STATUSES.has(name)) return false;
  if (!SUCCESS_STATUSES.has(name)) return false;
  // Consensus being reached (ACCEPTED/FINALIZED) only means validators
  // agreed on the OUTCOME -- that outcome can itself be a contract-level
  // error (e.g. every validator agreeing the call correctly raised
  // gl.vm.UserError). A transaction is only a genuine success if the
  // leader's own execution_result is SUCCESS, not merely "decided".
  return leaderExecutionResult(receipt) === "SUCCESS";
}

export function toGenWei(amountStr) {
  const [whole, frac = ""] = String(amountStr).split(".");
  const paddedFrac = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(paddedFrac || "0");
}
