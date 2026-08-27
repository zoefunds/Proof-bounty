"use client";

import { useMemo, useState } from "react";
import { useContractRead } from "@/lib/use-contract-read";
import { VALID_CATEGORIES } from "@/lib/contract-config";
import { BountyCard, type BountySummary } from "@/components/bounty/BountyCard";

const SORT_OPTIONS = [
  { value: "reward-desc", label: "Highest Reward" },
  { value: "ending-soon", label: "Ending Soon" },
  { value: "newest", label: "Newest" },
] as const;

export default function ExplorePage() {
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]["value"]>("newest");

  const { data, isLoading, error } = useContractRead<BountySummary[]>("list_bounties", [0, 200]);

  const filtered = useMemo(() => {
    let bounties = data ?? [];
    if (category) bounties = bounties.filter((b) => b.category === category);
    const sorted = [...bounties];
    if (sort === "reward-desc") {
      sorted.sort((a, b) => Number(b.reward_amount) - Number(a.reward_amount));
    } else if (sort === "ending-soon") {
      sorted.sort((a, b) => a.deadline - b.deadline);
    } else {
      sorted.sort((a, b) => b.bounty_id - a.bounty_id);
    }
    return sorted;
  }, [data, category, sort]);

  return (
    <main className="flex-grow w-full px-4 md:px-16 max-w-[1280px] mx-auto py-8">
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="font-headline text-3xl md:text-4xl font-bold text-on-surface mb-2">
            Explore Proofs
          </h1>
          <p className="font-body text-on-surface-variant max-w-2xl">
            Discover verifiable public claims. Stake your reputation, provide cryptographic
            evidence, and earn rewards.
          </p>
        </div>
        <span className="font-mono-data text-xs text-on-surface-variant">
          {data ? `${data.length} BOUNT${data.length === 1 ? "Y" : "IES"}` : "LOADING"}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="w-full lg:w-64 flex-shrink-0">
          <div className="bg-deep-navy border border-border-subtle rounded-lg p-4 lg:sticky lg:top-24">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-mono-data text-[11px] tracking-widest uppercase text-on-surface">
                Category
              </h2>
              {category && (
                <button
                  onClick={() => setCategory(null)}
                  className="font-body text-xs text-on-surface-variant hover:text-action-green"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {VALID_CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(category === c ? null : c)}
                  className={`text-left font-body text-sm px-3 py-2 rounded transition-colors ${
                    category === c
                      ? "bg-action-green/10 text-action-green border border-action-green/40"
                      : "text-on-surface-variant hover:text-on-surface border border-transparent"
                  }`}
                >
                  {c.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex-grow">
          <div className="flex justify-between items-center mb-4 bg-deep-navy p-2 rounded border border-border-subtle">
            <div className="font-body text-sm text-on-surface-variant px-2">
              {isLoading ? "Loading..." : `Showing ${filtered.length} proof${filtered.length === 1 ? "" : "s"}`}
            </div>
            <div className="flex items-center gap-2 px-2">
              <span className="font-body text-sm text-on-surface-variant">Sort by:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="bg-surface-container border border-border-subtle rounded font-body text-sm text-on-surface py-1 pl-2 pr-6 focus:border-electric-blue focus:outline-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-56 rounded-lg bg-surface-container-highest animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-status-rejected/30 p-12 text-center font-body text-sm text-status-rejected">
              Could not load bounties: {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-subtle p-12 text-center font-body text-sm text-on-surface-variant">
              No bounties match this filter yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((bounty) => (
                <BountyCard key={bounty.bounty_id} bounty={bounty} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
