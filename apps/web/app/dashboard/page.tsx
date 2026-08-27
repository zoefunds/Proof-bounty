"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet-context";
import { useContractRead } from "@/lib/use-contract-read";
import { formatGen } from "@/lib/format";
import type { ReputationSummary } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function DashboardPage() {
  const { address } = useWallet();
  const { data: rep, isLoading } = useContractRead<ReputationSummary>(
    "get_reputation",
    [address ?? ""],
    { enabled: !!address }
  );

  if (!address) {
    return (
      <main className="flex-grow flex items-center justify-center px-4 py-24">
        <div className="glass-panel rounded-xl p-10 text-center max-w-md">
          <h1 className="font-headline text-2xl text-on-surface mb-3">Connect Your Wallet</h1>
          <p className="font-body text-sm text-on-surface-variant">
            Your dashboard reads directly from on-chain reputation and escrow state tied to your
            connected wallet — connect to view it.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-grow w-full px-4 md:px-16 max-w-[1280px] mx-auto py-8">
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="font-headline text-3xl md:text-4xl font-bold text-on-surface mb-2">Dashboard</h1>
          <p className="font-body text-on-surface-variant">On-chain activity for your connected wallet.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/create"><Button>Create Bounty</Button></Link>
          <Link href="/my-attempts"><Button variant="secondary">My Attempts</Button></Link>
          <Link href={`/profile/${address}`}><Button variant="ghost">View Public Profile</Button></Link>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-surface-container-highest animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Bounties Created" value={String(rep?.bounties_created ?? 0)} />
            <StatCard label="Attempts Made" value={String(rep?.attempts_made ?? 0)} />
            <StatCard label="Attempts Won" value={String(rep?.attempts_won ?? 0)} accent />
            <StatCard label="Attempts Disputed" value={String(rep?.attempts_disputed ?? 0)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <Card className="p-6">
              <div className="font-mono-data text-[11px] uppercase tracking-wide text-on-surface-variant mb-2">
                Total Earned (as challenger)
              </div>
              <div className="font-headline text-3xl text-action-green">
                {formatGen(rep?.total_earned ?? 0)} <span className="text-sm">GEN</span>
              </div>
            </Card>
            <Card className="p-6">
              <div className="font-mono-data text-[11px] uppercase tracking-wide text-on-surface-variant mb-2">
                Total Funded (as creator)
              </div>
              <div className="font-headline text-3xl text-tertiary-fixed-dim">
                {formatGen(rep?.bounties_funded_total ?? 0)} <span className="text-sm">GEN</span>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <div className="font-mono-data text-[11px] uppercase tracking-wide text-on-surface-variant mb-3">
              Outcome breakdown
            </div>
            <div className="grid grid-cols-3 gap-4 font-body text-sm">
              <div>
                <div className="text-status-approved font-headline text-xl">{rep?.attempts_won ?? 0}</div>
                <div className="text-on-surface-variant text-xs mt-1">Won / Partial</div>
              </div>
              <div>
                <div className="text-status-partial font-headline text-xl">{rep?.attempts_partial ?? 0}</div>
                <div className="text-on-surface-variant text-xs mt-1">Partial payouts</div>
              </div>
              <div>
                <div className="text-status-rejected font-headline text-xl">{rep?.attempts_rejected ?? 0}</div>
                <div className="text-on-surface-variant text-xs mt-1">Rejected</div>
              </div>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="p-5">
      <div className="font-mono-data text-[10px] uppercase tracking-wide text-on-surface-variant mb-2">
        {label}
      </div>
      <div className={`font-headline text-2xl ${accent ? "text-action-green" : "text-on-surface"}`}>{value}</div>
    </Card>
  );
}
