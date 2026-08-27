"use client";

import { useWallet } from "@/lib/wallet-context";
import { CONTRACT_ADDRESS, GENLAYER_CHAIN, isContractConfigured } from "@/lib/contract-config";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function SettingsPage() {
  const { address, disconnect } = useWallet();

  return (
    <main className="flex-grow w-full px-4 md:px-16 max-w-[720px] mx-auto py-8">
      <h1 className="font-headline text-3xl font-bold text-on-surface mb-8">Settings</h1>

      <Card className="p-6 mb-6">
        <h2 className="font-body font-bold text-sm uppercase tracking-wider text-on-surface mb-4">
          Wallet
        </h2>
        {address ? (
          <div className="flex flex-col gap-3">
            <Row label="Connected address" value={address} mono />
            <p className="font-body text-xs text-on-surface-variant">
              PROOFBOUNTY uses wallet-based authentication — the connected wallet above is the
              same wallet every reward, bond refund, and partial payout is sent to directly.
              There is no separate custody layer and nothing to export: your wallet extension
              (MetaMask or equivalent) already controls your private key.
            </p>
            <Button variant="danger" onClick={disconnect} className="w-fit">
              Disconnect Wallet
            </Button>
          </div>
        ) : (
          <p className="font-body text-sm text-on-surface-variant">No wallet connected.</p>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="font-body font-bold text-sm uppercase tracking-wider text-on-surface mb-4">
          Network
        </h2>
        <div className="flex flex-col gap-3">
          <Row label="Network" value={GENLAYER_CHAIN.name} mono />
          <Row label="RPC endpoint" value={GENLAYER_CHAIN.rpcUrl} mono />
          <Row
            label="ProofBounty contract"
            value={isContractConfigured() ? CONTRACT_ADDRESS : "Not configured"}
            mono
          />
        </div>
      </Card>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono-data text-[10px] uppercase tracking-wide text-on-surface-variant">
        {label}
      </span>
      <span className={`text-sm break-all ${mono ? "font-mono-data text-electric-blue" : "text-on-surface"}`}>
        {value}
      </span>
    </div>
  );
}
