"use client";

import Link from "next/link";
import { useContractRead } from "@/lib/use-contract-read";
import { truncateAddress, formatTimestamp } from "@/lib/format";
import type { AttemptDetail } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/StatusPill";

export default function DisputesPage() {
  const { data, isLoading, error } = useContractRead<AttemptDetail[]>("get_disputed_attempts", [
    0,
    200,
  ]);

  return (
    <main className="flex-grow w-full px-4 md:px-16 max-w-[1280px] mx-auto py-8">
      <div className="mb-8">
        <h1 className="font-headline text-3xl md:text-4xl font-bold text-on-surface mb-2">Disputes</h1>
        <p className="font-body text-on-surface-variant max-w-2xl">
          Attempts currently under dispute, awaiting arbiter resolution or the arbiter-grace
          default recovery path.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface-container-highest animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="font-body text-sm text-status-rejected">Could not load disputes: {error}</p>
      ) : !data || data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle p-12 text-center font-body text-sm text-on-surface-variant">
          No active disputes right now.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((attempt) => (
            <Link key={`${attempt.bounty_id}-${attempt.index}`} href={`/bounty/${attempt.bounty_id}`}>
              <Card className="p-5 hover:border-status-disputed/40 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-mono-data text-xs text-on-surface-variant">
                    Bounty #{attempt.bounty_id} · Attempt #{attempt.index}
                  </span>
                  <StatusPill status="DISPUTED" />
                </div>
                <p className="font-body text-sm text-on-surface mb-2">{attempt.dispute_reason}</p>
                <div className="font-mono-data text-[11px] text-on-surface-variant flex justify-between">
                  <span>Disputed by {truncateAddress(attempt.disputed_by)}</span>
                  <span>{formatTimestamp(attempt.resolved_at || attempt.submitted_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
