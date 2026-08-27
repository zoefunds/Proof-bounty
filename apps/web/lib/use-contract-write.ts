"use client";

/**
 * Full transaction-lifecycle hook for every write call against ProofBounty.
 *
 * Implements PROOFBOUNTY.md section 33's required state machine —
 * IDLE -> WALLET_REQUEST -> AWAITING_SIGNATURE -> SUBMITTED -> PENDING ->
 * CONFIRMED, plus REJECTED / FAILED / TIMEOUT / WRONG_NETWORK /
 * INSUFFICIENT_FUNDS / RPC_ERROR / USER_REJECTED — as a single reusable
 * hook, so no page has to hand-roll (or skip) proper wallet UX. Every
 * bounty/attempt action in this app (`create_bounty`, `accept_bounty`,
 * `submit_evidence`, `request_verification`, disputes, admin) goes through
 * this hook rather than calling `client.writeContract` directly.
 */

import { useCallback, useState } from "react";
import type { CalldataEncodable } from "genlayer-js/types";
import { getContractAddress } from "./genlayer-client";
import { useGenLayerClient } from "./wallet-context";

export type TxState =
  | "IDLE"
  | "WALLET_REQUEST"
  | "AWAITING_SIGNATURE"
  | "SUBMITTED"
  | "PENDING"
  | "CONFIRMED"
  | "REJECTED"
  | "FAILED"
  | "TIMEOUT"
  | "WRONG_NETWORK"
  | "INSUFFICIENT_FUNDS"
  | "RPC_ERROR"
  | "USER_REJECTED";

export const TERMINAL_FAILURE_STATES: TxState[] = [
  "REJECTED",
  "FAILED",
  "TIMEOUT",
  "WRONG_NETWORK",
  "INSUFFICIENT_FUNDS",
  "RPC_ERROR",
  "USER_REJECTED",
];

interface WriteArgs {
  functionName: string;
  args?: CalldataEncodable[];
  value?: bigint;
}

interface UseContractWriteResult {
  state: TxState;
  txHash: string | null;
  errorMessage: string | null;
  isBusy: boolean;
  isSuccess: boolean;
  isFailure: boolean;
  write: (args: WriteArgs) => Promise<boolean>;
  reset: () => void;
}

function classifyError(err: unknown): { state: TxState; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return { state: "USER_REJECTED", message: "You rejected the transaction in your wallet." };
  }
  if (lower.includes("insufficient funds") || lower.includes("insufficient balance")) {
    return {
      state: "INSUFFICIENT_FUNDS",
      message: "Your wallet does not have enough GEN to cover this transaction.",
    };
  }
  if (lower.includes("chain") && (lower.includes("mismatch") || lower.includes("wrong"))) {
    return {
      state: "WRONG_NETWORK",
      message: "Your wallet is connected to the wrong network. Switch to GenLayer StudioNet.",
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      state: "TIMEOUT",
      message: "The transaction timed out waiting for confirmation. Check the explorer to verify its final status.",
    };
  }
  if (lower.includes("network") || lower.includes("fetch failed") || lower.includes("rpc")) {
    return {
      state: "RPC_ERROR",
      message: "Could not reach the GenLayer network. Check your connection and try again.",
    };
  }
  return { state: "FAILED", message };
}

export function useContractWrite(): UseContractWriteResult {
  const client = useGenLayerClient();
  const [state, setState] = useState<TxState>("IDLE");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setState("IDLE");
    setTxHash(null);
    setErrorMessage(null);
  }, []);

  const write = useCallback(
    async ({ functionName, args = [], value = BigInt(0) }: WriteArgs): Promise<boolean> => {
      if (!client) {
        setState("RPC_ERROR");
        setErrorMessage("Connect your wallet first.");
        return false;
      }

      setErrorMessage(null);
      try {
        setState("WALLET_REQUEST");
        const address = getContractAddress();

        setState("AWAITING_SIGNATURE");
        const hash = await client.writeContract({
          address,
          functionName,
          args,
          value,
        });
        const hashStr = typeof hash === "string" ? hash : String(hash);
        setTxHash(hashStr);
        setState("SUBMITTED");

        setState("PENDING");
        const receipt = await client.waitForTransactionReceipt({
          hash: hashStr as unknown as Parameters<typeof client.waitForTransactionReceipt>[0]["hash"],
          retries: 40,
          interval: 3000,
        });

        const status = (receipt as { status?: string; statusName?: string })?.status ??
          (receipt as { statusName?: string })?.statusName ??
          "";
        const succeeded = String(status).toUpperCase().includes("FINAL") ||
          String(status).toUpperCase().includes("SUCCESS") ||
          String(status).toUpperCase().includes("ACCEPTED");

        if (succeeded) {
          setState("CONFIRMED");
          return true;
        }
        setState("FAILED");
        setErrorMessage(
          `Transaction did not finalize successfully (status: ${status || "unknown"}). ` +
            "Check the transaction hash in GenLayer Studio for details."
        );
        return false;
      } catch (err) {
        const { state: failState, message } = classifyError(err);
        setState(failState);
        setErrorMessage(message);
        return false;
      }
    },
    [client]
  );

  const isBusy = ["WALLET_REQUEST", "AWAITING_SIGNATURE", "SUBMITTED", "PENDING"].includes(state);
  const isSuccess = state === "CONFIRMED";
  const isFailure = TERMINAL_FAILURE_STATES.includes(state);

  return { state, txHash, errorMessage, isBusy, isSuccess, isFailure, write, reset };
}
