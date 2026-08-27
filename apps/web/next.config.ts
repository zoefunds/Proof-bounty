import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // @reown/appkit-adapter-ethers pulls in @coinbase/cdp-sdk (Coinbase
  // Smart Wallet support) transitively, which dynamically imports
  // optional x402-payments packages (@x402/svm/*, @x402/core/*) we never
  // installed and never use -- this app doesn't use Coinbase's embedded
  // payment flow, only ordinary wallet connect. Marking the SDK external
  // stops Next from trying to statically bundle those missing optional
  // deps during the server-side render pass of client components.
  serverExternalPackages: ["@coinbase/cdp-sdk", "@base-org/account"],
};

export default nextConfig;
