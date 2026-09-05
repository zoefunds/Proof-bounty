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
