import type { TxState } from "@/lib/use-contract-write";
import { truncateAddress } from "@/lib/format";

const STATE_COPY: Record<TxState, string> = {
  IDLE: "",
  WALLET_REQUEST: "Preparing transaction request...",
  AWAITING_SIGNATURE: "Confirm this transaction in your wallet...",
  SUBMITTED: "Transaction submitted to GenLayer StudioNet...",
  PENDING: "Awaiting validator consensus and finalization...",
  CONFIRMED: "Transaction confirmed.",
  REJECTED: "Transaction was rejected.",
  FAILED: "Transaction failed.",
  TIMEOUT: "Timed out waiting for confirmation.",
  WRONG_NETWORK: "Wrong network selected in your wallet.",
  INSUFFICIENT_FUNDS: "Insufficient GEN balance.",
  RPC_ERROR: "Could not reach the network.",
  USER_REJECTED: "You rejected the transaction.",
};

export function TxStateBanner({
  state,
  txHash,
  errorMessage,
}: {
  state: TxState;
  txHash: string | null;
  errorMessage: string | null;
}) {
  if (state === "IDLE") return null;

  const isBusy = ["WALLET_REQUEST", "AWAITING_SIGNATURE", "SUBMITTED", "PENDING"].includes(state);
  const isSuccess = state === "CONFIRMED";
  const isFailure = !isBusy && !isSuccess;

  return (
    <div
      className={`rounded-md border p-3 flex items-start gap-3 font-mono-data text-xs ${
        isSuccess
          ? "border-status-approved/40 bg-status-approved/10 text-status-approved"
          : isFailure
          ? "border-status-rejected/40 bg-status-rejected/10 text-status-rejected"
          : "border-electric-blue/40 bg-electric-blue/10 text-electric-blue"
      }`}
    >
      {isBusy && (
        <span className="mt-0.5 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      <div className="flex flex-col gap-1">
        <span className="uppercase tracking-wide">{state.replace(/_/g, " ")}</span>
        <span className="text-on-surface-variant normal-case">
          {errorMessage ?? STATE_COPY[state]}
        </span>
        {txHash && (
          <span className="text-on-surface-variant normal-case">tx: {truncateAddress(txHash, 8)}</span>
        )}
      </div>
    </div>
  );
}
