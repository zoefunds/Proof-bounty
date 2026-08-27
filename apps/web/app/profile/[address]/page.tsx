"use client";

import { useParams } from "next/navigation";
import { useContractRead } from "@/lib/use-contract-read";
import { formatGen, truncateAddress } from "@/lib/format";
import type { ReputationSummary } from "@/lib/types";
import { Card } from "@/components/ui/Card";

export default function ProfilePage() {
  const params = useParams<{ address: string }>();
  const address = decodeURIComponent(params.address);

  const { data: rep, isLoading, error } = useContractRead<ReputationSummary>("get_reputation", [
    address,
  ]);

  const successRate =
    rep && rep.attempts_made > 0
      ? Math.round(((rep.attempts_won as number) / (rep.attempts_made as number)) * 100)
      : null;

  return (
    <main className="flex-grow w-full px-4 md:px-16 max-w-[1280px] mx-auto py-8">
      <div className="mb-8">
        <span className="font-mono-data text-[11px] uppercase tracking-widest text-on-surface-variant">
          Reputation Profile
        </span>
        <h1 className="font-headline text-3xl md:text-4xl font-bold text-on-surface mt-1 break-all">
          {truncateAddress(address, 8)}
        </h1>
      </div>

      {isLoading ? (
        <div className="h-64 rounded-lg bg-surface-container-highest animate-pulse" />
      ) : error ? (
        <p className="font-body text-sm text-status-rejected">Could not load reputation: {error}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-6 lg:col-span-2">
            <h2 className="font-headline text-xl text-on-surface mb-6">Prover Record</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <Metric label="Attempts Made" value={rep?.attempts_made ?? 0} />
              <Metric label="Won / Partial" value={rep?.attempts_won ?? 0} accent="text-status-approved" />
              <Metric label="Partial" value={rep?.attempts_partial ?? 0} accent="text-status-partial" />
              <Metric label="Rejected" value={rep?.attempts_rejected ?? 0} accent="text-status-rejected" />
            </div>
            {successRate !== null && (
              <div className="mt-6 pt-6 border-t border-border-subtle">
                <div className="font-mono-data text-[10px] uppercase text-on-surface-variant mb-2">
                  Success Rate
                </div>
                <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-action-green rounded-full"
                    style={{ width: `${successRate}%` }}
                  />
                </div>
                <div className="font-mono-data text-xs text-action-green mt-1">{successRate}%</div>
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="p-6">
              <div className="font-mono-data text-[10px] uppercase text-on-surface-variant mb-2">
                Total Earned
              </div>
              <div className="font-headline text-2xl text-action-green">
                {formatGen(rep?.total_earned ?? 0)} GEN
              </div>
            </Card>
            <Card className="p-6">
              <div className="font-mono-data text-[10px] uppercase text-on-surface-variant mb-2">
                Bounties Created
              </div>
              <div className="font-headline text-2xl text-on-surface">{rep?.bounties_created ?? 0}</div>
              <div className="font-body text-xs text-on-surface-variant mt-1">
                {formatGen(rep?.bounties_funded_total ?? 0)} GEN funded total
              </div>
            </Card>
          </div>
        </div>
      )}

      <p className="font-body text-xs text-on-surface-variant mt-8">
        Every metric on this page is derived directly from settled on-chain events — never
        self-reported.
      </p>
    </main>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <div className={`font-headline text-2xl ${accent ?? "text-on-surface"}`}>{value}</div>
      <div className="font-mono-data text-[10px] uppercase tracking-wide text-on-surface-variant mt-1">
        {label}
      </div>
    </div>
  );
}
