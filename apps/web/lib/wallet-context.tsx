"use client";

/**
 * Wallet connection + transaction-lifecycle context, backed by Reown
 * AppKit (WalletConnect) — see lib/reown-config.ts for why. Any wallet
 * AppKit connects (injected extension, WalletConnect-paired mobile
 * wallet, Coinbase Wallet, etc.) is the same wallet every contract
 * payout goes to directly — there is still no separate custody layer.
 *
 * This context deliberately tracks a `TxState` machine per PROOFBOUNTY.md
 * section 33 — IDLE -> WALLET_REQUEST -> AWAITING_SIGNATURE -> SUBMITTED ->
 * PENDING -> CONFIRMED, with REJECTED / FAILED / TIMEOUT / WRONG_NETWORK /
 * INSUFFICIENT_FUNDS / RPC_ERROR / USER_REJECTED failure states — see
 * lib/use-contract-write.ts, which is unaffected by this change (it only
 * ever consumes the EIP-1193 provider this context exposes).
 */

import { useMemo, type ReactNode } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit-controllers/react";
import "@/lib/reown-config";
import { makeGenLayerClient, type EthereumProvider } from "./genlayer-client";

interface WalletContextValue {
  address: `0x${string}` | null;
  isConnecting: boolean;
  isWalletAvailable: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// No React context needed: importing lib/reown-config.ts (above) runs
// `createAppKit(...)` once at module scope, and Reown's own hooks
// (useAppKitAccount, useAppKitProvider, etc.) read from AppKit's internal
// store directly rather than from React context. This wrapper only exists
// so app/layout.tsx's existing `<WalletProvider>` call keeps compiling —
// it renders nothing but its children.
export function WalletProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// `useWallet()` adapts Reown's hooks to the same interface the rest of
// the app already expects, so no other file needs to change.
export function useWallet(): WalletContextValue {
  const { open } = useAppKit();
  const { address, isConnected, status } = useAppKitAccount();
  const { disconnect: appKitDisconnect } = useDisconnect();

  return {
    address: isConnected && address ? (address as `0x${string}`) : null,
    isConnecting: status === "connecting",
    isWalletAvailable: true, // AppKit always offers WalletConnect even with no extension installed
    error: null,
    connect: async () => {
      await open();
    },
    disconnect: () => {
      appKitDisconnect();
    },
  };
}

/** Convenience hook: a GenLayer client bound to the connected wallet's
 * EIP-1193 provider (from AppKit), or null if not connected. */
export function useGenLayerClient() {
  const { address } = useWallet();
  const { walletProvider } = useAppKitProvider<EthereumProvider>("eip155");

  return useMemo(
    () => (address && walletProvider ? makeGenLayerClient(address, walletProvider) : null),
    [address, walletProvider]
  );
}
