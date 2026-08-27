"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet-context";
import { useMyActivity } from "@/lib/use-my-activity";
import { formatGen, bpsToPercent } from "@/lib/format";
import { StatusPill } from "@/components/ui/StatusPill";
import { Card } from "@/components/ui/Card";

export default function MyAttemptsPage() {
  const { address } = useWallet();
  const { myBounties, myAttempts, isLoading, error, usedFallback } = useMyActivity(address);

  if (!address) {
    return (
      <main className="flex-grow flex items-center justify-center px-4 py-24">
        <div className="glass-panel rounded-xl p-10 text-center max-w-md">
          <h1 className="font-headline text-2xl text-on-surface mb-3">Connect Your Wallet</h1>
          <p className="font-body text-sm text-on-surface-variant">
            Connect to see the bounties you&apos;ve created and attempts you&apos;ve made.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-grow w-full px-4 md:px-16 max-w-[1280px] mx-auto py-8">
      <h1 className="font-headline text-3xl md:text-4xl font-bold text-on-surface mb-8">
        My Activity
      </h1>

      {isLoading && (
        <p className="font-mono-data text-xs text-on-surface-variant mb-6">Loading your activity...</p>
      )}
      {usedFallback && !isLoading && (
        <p className="font-mono-data text-xs text-status-partial mb-6">
          The backend indexer was unreachable — showing results from a direct on-chain scan
          instead (may be slower to load).
        </p>
      )}
      {error && <p className="font-body text-sm text-status-rejected mb-6">Error: {error}</p>}

      <section className="mb-10">
        <h2 className="font-headline text-xl text-on-surface mb-4">My Bounties ({myBounties.length})</h2>
        {myBounties.length === 0 ? (
          <EmptyRow message="You haven't created any bounties yet." />
        ) : (
          <div className="flex flex-col gap-3">
            {myBounties.map((b) => (
              <Link key={b.bounty_id} href={`/bounty/${b.bounty_id}`}>
                <Card className="p-4 flex justify-between items-center hover:border-action-green/30">
                  <div>
                    <div className="font-body text-sm text-on-surface">{b.title}</div>
                    <div className="font-mono-data text-[11px] text-on-surface-variant mt-1">
                      {formatGen(b.reward_amount)} GEN · {b.attempt_count} attempt(s)
                    </div>
                  </div>
                  <StatusPill status={b.status_label} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-headline text-xl text-on-surface mb-4">My Attempts ({myAttempts.length})</h2>
        {myAttempts.length === 0 ? (
          <EmptyRow message="You haven't attempted any bounties yet." />
        ) : (
          <div className="flex flex-col gap-3">
            {myAttempts.map(({ bounty, attempt }) => (
              <Link key={`${bounty.bounty_id}-${attempt.index}`} href={`/bounty/${bounty.bounty_id}`}>
                <Card className="p-4 flex justify-between items-center hover:border-action-green/30">
                  <div>
                    <div className="font-body text-sm text-on-surface">{bounty.title}</div>
                    <div className="font-mono-data text-[11px] text-on-surface-variant mt-1">
                      Bond {formatGen(attempt.bond_deposited || attempt.bond_amount)} GEN
                      {attempt.last_payout_bps > 0 && ` · ${bpsToPercent(attempt.last_payout_bps)} payout`}
                    </div>
                  </div>
                  <StatusPill status={attempt.status_label} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle p-8 text-center font-body text-sm text-on-surface-variant">
      {message}
    </div>
  );
}
