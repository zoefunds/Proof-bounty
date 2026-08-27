/**
 * Server-side, read-only GenLayer client. Only ever calls `readContract`
 * (view methods) — the backend never signs or submits transactions; every
 * write in PROOFBOUNTY happens from the user's own connected wallet in the
 * frontend (see apps/web/lib/genlayer-client.ts). The backend's sole job
 * is to poll the contract's own view methods on an interval and cache the
 * results for fast search/filter/activity-feed queries (PROOFBOUNTY.md
 * section 30).
 */

import { createClient, chains } from "genlayer-js";
import type { Address } from "genlayer-js/types";
import { env } from "./env.js";
import { throttleGenLayerCall } from "./rate-limiter.js";

const client = createClient({
  chain: chains.studionet,
  endpoint: env.GENLAYER_RPC_URL,
});

const CONTRACT_ADDRESS = env.PROOFBOUNTY_CONTRACT_ADDRESS as Address;

export async function readContract<T>(functionName: string, args: unknown[] = []): Promise<T> {
  await throttleGenLayerCall();
  const result = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never,
  });
  return result as unknown as T;
}
