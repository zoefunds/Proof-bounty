/**
 * Server-side GenLayer access. Normal indexing is read-only. The one narrow
 * write authority is the funding-attestor key, which may only activate a
 * reservation after the Base receipt and event have been reconciled.
 */

import { createClient, createAccount, chains } from "genlayer-js";
import type { Address } from "genlayer-js/types";
import { env } from "./env.js";
import { throttleGenLayerCall } from "./rate-limiter.js";

const client = createClient({
  chain: chains.studionet,
  endpoint: env.GENLAYER_RPC_URL,
});

const CONTRACT_ADDRESS = env.PROOFBOUNTY_CONTRACT_ADDRESS as Address;

// StudioNet's RPC gateway has, in real live testing, occasionally not just
// errored but genuinely hung -- opened a connection and never sent a
// response, no error, no close. genlayer-js's underlying fetch has no
// default timeout (Node's fetch will wait indefinitely), so an unguarded
// `client.readContract` call can wedge whatever awaits it forever. This was
// confirmed live: the indexer's poll loop got stuck on exactly this and
// never recovered even across a process restart, because the very next
// poll hit the same hang again. A hard per-call timeout is the fix --
// `Promise.race` can't cancel the underlying hung request, but it does
// guarantee the CALLER is released, which is what actually matters here
// (the poll loop moving on, not the individual hung socket).
const READ_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function readContract<T>(functionName: string, args: unknown[] = []): Promise<T> {
  // The rate limiter's own Redis round-trip is wrapped too, not just the
  // RPC call -- a stuck Redis connection (no connect timeout configured on
  // the ioredis client) would otherwise hang this function just as badly
  // as a stuck RPC call would, and this project has already been bitten
  // once by assuming only the "obvious" outbound call needed a timeout.
  await withTimeout(throttleGenLayerCall(), READ_TIMEOUT_MS, "throttleGenLayerCall");
  const result = await withTimeout(
    client.readContract({
      address: CONTRACT_ADDRESS,
      functionName,
      args: args as never,
    }),
    READ_TIMEOUT_MS,
    `readContract(${functionName})`
  );
  return result as unknown as T;
}

export async function attestAttemptFunding(bountyId: number, reservationId: number, baseFundingTxHash: string) {
  if (!env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY) throw new Error("funding attestor is not configured");
  const privateKey = (env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY.startsWith("0x")
    ? env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY
    : `0x${env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY}`) as `0x${string}`;
  const account = createAccount(privateKey);
  const writer = createClient({ chain: chains.studionet, endpoint: env.GENLAYER_RPC_URL, account });
  const hash = await writer.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "confirm_attempt_funding",
    args: [bountyId, reservationId, baseFundingTxHash] as never,
    value: 0n,
  });
  const receipt = await writer.waitForTransactionReceipt({ hash, retries: 60, interval: 3000 });
  const rawStatus = (receipt as { status?: string | number; statusName?: string }).status ??
    (receipt as { statusName?: string }).statusName ?? "";
  const status = typeof rawStatus === "number" || /^\d+$/.test(String(rawStatus))
    ? ({ 5: "ACCEPTED", 7: "FINALIZED" }[Number(rawStatus)] ?? String(rawStatus))
    : String(rawStatus);
  const execution = (receipt as { consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> } })
    .consensus_data?.leader_receipt?.[0]?.execution_result;
  if (!/FINAL|ACCEPTED/i.test(status) || (execution && execution !== "SUCCESS")) {
    throw new Error(`GenLayer funding attestation failed (${status || "unknown status"}/${execution || "unknown execution"})`);
  }
  return String(hash);
}

export async function attestAppealFunding(bountyId: number, attemptIndex: number, baseFundingTxHash: string) {
  if (!env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY) throw new Error("funding attestor is not configured");
  const privateKey = (env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY.startsWith("0x")
    ? env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY : `0x${env.GENLAYER_FUNDING_ATTESTOR_PRIVATE_KEY}`) as `0x${string}`;
  const account = createAccount(privateKey);
  const writer = createClient({ chain: chains.studionet, endpoint: env.GENLAYER_RPC_URL, account });
  const hash = await writer.writeContract({ address: CONTRACT_ADDRESS, functionName: "confirm_appeal_funding", args: [bountyId, attemptIndex, baseFundingTxHash] as never, value: 0n });
  const receipt = await writer.waitForTransactionReceipt({ hash, retries: 60, interval: 3000 });
  const raw = (receipt as { status?: string | number; statusName?: string }).status ?? (receipt as { statusName?: string }).statusName ?? "";
  const status = typeof raw === "number" || /^\d+$/.test(String(raw)) ? ({ 5: "ACCEPTED", 7: "FINALIZED" }[Number(raw)] ?? String(raw)) : String(raw);
  const execution = (receipt as { consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> } }).consensus_data?.leader_receipt?.[0]?.execution_result;
  if (!/FINAL|ACCEPTED/i.test(status) || (execution && execution !== "SUCCESS")) throw new Error(`GenLayer appeal funding attestation failed (${status || "unknown status"}/${execution || "unknown execution"})`);
  return String(hash);
}
