"use client";

import { useWallet } from "@/lib/wallet-context";
import { truncateAddress } from "@/lib/format";
import { Button } from "../ui/Button";

export function ConnectWalletButton() {
  const { address, isConnecting, isWalletAvailable, connect, disconnect, error } = useWallet();

  if (address) {
    return (
      <button
        onClick={disconnect}
        title="Click to disconnect"
        className="font-mono-data text-[13px] px-4 py-2 rounded-md bg-surface-container-highest border border-border-subtle text-action-green hover:border-status-rejected/50 hover:text-status-rejected transition-colors"
      >
        {truncateAddress(address)}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={connect} isLoading={isConnecting} disabled={!isWalletAvailable}>
        {isWalletAvailable ? "Connect Wallet" : "No Wallet Found"}
      </Button>
      {error && <span className="text-[11px] text-status-rejected max-w-[220px] text-right">{error}</span>}
    </div>
  );
}
