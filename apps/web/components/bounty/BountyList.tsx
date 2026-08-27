"use client";

import { useContractRead } from "@/lib/use-contract-read";
import { isContractConfigured } from "@/lib/contract-config";
import { BountyCard, type BountySummary } from "./BountyCard";

export function BountyList({
  startId = 0,
  limit = 12,
  emptyMessage = "No bounties yet. Be the first to put money behind a claim.",
}: {
  startId?: number;
  limit?: number;
  emptyMessage?: string;
}) {
  const { data, isLoading, error } = useContractRead<BountySummary[]>("list_bounties", [
    startId,
    limit,
  ]);

  if (!isContractConfigured()) {
    return (
      <EmptyState message="Contract not yet configured. Set NEXT_PUBLIC_PROOFBOUNTY_CONTRACT_ADDRESS." />
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-56 rounded-lg bg-surface-container-highest animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <EmptyState message={`Could not load bounties: ${error}`} isError />;
  }

  if (!data || data.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {data.map((bounty) => (
        <BountyCard key={bounty.bounty_id} bounty={bounty} />
      ))}
    </div>
  );
}

function EmptyState({ message, isError }: { message: string; isError?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-dashed p-12 text-center font-body text-sm ${
        isError ? "border-status-rejected/30 text-status-rejected" : "border-border-subtle text-on-surface-variant"
      }`}
    >
      {message}
    </div>
  );
}
