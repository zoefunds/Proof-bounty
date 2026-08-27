"use client";

/**
 * Thin wrapper around `genlayer-js`'s `createClient`, verified against the
 * SDK's own shipped type declarations
 * (`node_modules/genlayer-js/dist/index.d.ts`) rather than guessed --
 * `createClient({ chain, provider, account })` with `provider` set to a
 * standard EIP-1193 wallet provider is the current, officially supported
 * path for StudioNet. The provider itself now comes from Reown AppKit
 * (see lib/reown-config.ts / lib/wallet-context.tsx) rather than reading
 * `window.ethereum` directly -- AppKit supports far more than a single
 * injected extension (WalletConnect-paired mobile wallets, Coinbase
 * Wallet, etc.), but whichever wallet it connects still exposes the same
 * EIP-1193 `request()` interface genlayer-js expects.
 */

import { createClient, chains } from "genlayer-js";
import type { Address } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./contract-config";

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

/**
 * Build a GenLayer client bound to the connected wallet address and its
 * EIP-1193 provider (supplied by Reown AppKit's `useAppKitProvider`).
 * Callers must have already connected via AppKit (see
 * `lib/wallet-context.tsx`'s `connect()`) -- this function never triggers
 * a connection prompt itself, it only wires up an already-authorized
 * account + provider pair.
 */
export function makeGenLayerClient(account: Address, provider: EthereumProvider) {
  return createClient({
    chain: chains.studionet,
    provider,
    account,
  });
}

/** Read-only client, no wallet needed -- used by every page that only
 * reads contract state (marketplace, bounty details before connecting). */
export function getReadOnlyClient() {
  return createClient({ chain: chains.studionet });
}

export function getContractAddress(): Address {
  if (!CONTRACT_ADDRESS) {
    throw new Error(
      "PROOFBOUNTY contract address is not configured yet. Set " +
        "NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS once the contract is deployed."
    );
  }
  return CONTRACT_ADDRESS as Address;
}
