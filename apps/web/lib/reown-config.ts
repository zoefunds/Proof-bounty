"use client";

/**
 * Reown AppKit (WalletConnect) configuration.
 *
 * Why this exists: the previous wallet integration only worked with a
 * browser extension exposing `window.ethereum` (MetaMask-style) — no
 * mobile wallets, no WalletConnect QR pairing, and it broke entirely for
 * anyone without an injected provider. Reown AppKit replaces that with a
 * proper multi-wallet connect flow (injected extensions, WalletConnect,
 * Coinbase Wallet, etc.) while still handing back a standard EIP-1193
 * provider that `genlayer-js`'s `createClient({ provider })` accepts
 * unchanged (see lib/genlayer-client.ts).
 *
 * `createAppKit` must be called exactly once, at module scope, in a file
 * that's imported by a client component mounted near the root — this is
 * Reown's documented Next.js App Router pattern. It's safe to call during
 * SSR; AppKit no-ops until it reaches the browser.
 */

import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { defineChain } from "@reown/appkit/networks";

const REOWN_PROJECT_ID =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "00a166f22ba09aef8f71d5c707ba0cdc";

// Mirrors genlayer-js's own `chains.studionet` definition (id, RPC,
// native currency) so the wallet and the GenLayer client always agree on
// which chain they're talking to.
export const studionetForReown = defineChain({
  id: 61999,
  caipNetworkId: "eip155:61999",
  chainNamespace: "eip155",
  name: "Genlayer Studio Network",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://studio.genlayer.com/api"] },
  },
  blockExplorers: {
    default: { name: "GenLayer Explorer", url: "https://genlayer-explorer.vercel.app" },
  },
  testnet: true,
});

const metadata = {
  name: "PROOFBOUNTY",
  description: "Put money behind a claim. Then let the internet prove whether you earned it.",
  url: "https://proof-bounty.vercel.app",
  icons: ["https://proof-bounty.vercel.app/logo-mark.svg"],
};

export const appKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [studionetForReown],
  defaultNetwork: studionetForReown,
  projectId: REOWN_PROJECT_ID,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: "dark",
});
