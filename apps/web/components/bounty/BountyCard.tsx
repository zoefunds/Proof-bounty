import Link from "next/link";
import { StatusPill } from "../ui/StatusPill";
import { formatGen, isExpired, truncateAddress } from "@/lib/format";
import { BOUNTY_STATUS_LABELS } from "@/lib/contract-config";

export interface BountySummary {
  bounty_id: number;
  title: string;
  claim_text: string;
  category: string;
  status: number;
  reward_amount: number | bigint | string;
  required_bond: number | bigint | string;
  attempt_count: number;
  deadline: number;
  creator: string;
}

export function BountyCard({ bounty }: { bounty: BountySummary }) {
  const rawStatus = BOUNTY_STATUS_LABELS[bounty.status] ?? "UNKNOWN";
  const statusLabel = rawStatus === "OPEN" && isExpired(bounty.deadline) ? "EXPIRED_REFUNDED" : rawStatus;
  return (
    <Link
      href={`/bounty/${bounty.bounty_id}`}
      className="group flex flex-col justify-between h-full relative overflow-hidden rounded-lg border border-border-subtle bg-deep-navy p-4 hover:bg-slate-surface hover:border-white/20 transition-all"
    >
      <div className="absolute top-0 left-0 w-full h-0.5 bg-action-green opacity-50" />
      <div>
        <div className="flex justify-between items-start mb-3 gap-2">
          <span className="inline-block px-2 py-1 bg-surface-container-highest rounded text-[10px] font-bold tracking-wider text-action-green uppercase font-mono-data">
            {bounty.category.replace(/_/g, " ")}
          </span>
          <StatusPill status={statusLabel} />
        </div>
        <h3 className="font-headline text-lg leading-tight text-on-surface mb-2 group-hover:text-action-green transition-colors">
          {bounty.title}
        </h3>
        <p className="font-body text-sm text-on-surface-variant mb-4 line-clamp-2">{bounty.claim_text}</p>
      </div>
      <div>
        <div className="grid grid-cols-2 gap-2 mb-3 bg-surface-container-highest p-3 rounded">
          <div>
            <div className="font-mono-data text-[10px] text-on-surface-variant mb-1">REWARD</div>
            <div className="font-headline text-lg text-action-green">
              {formatGen(bounty.reward_amount)} <span className="text-xs">GEN</span>
            </div>
          </div>
          <div>
            <div className="font-mono-data text-[10px] text-on-surface-variant mb-1">REQ. BOND</div>
            <div className="font-headline text-base text-on-surface">
              {formatGen(bounty.required_bond)} <span className="text-xs text-on-surface-variant">GEN</span>
            </div>
          </div>
        </div>
        <div className="flex justify-between items-center font-mono-data text-[11px] text-on-surface-variant">
          <span>{bounty.attempt_count} attempt{bounty.attempt_count === 1 ? "" : "s"}</span>
          <span>{truncateAddress(bounty.creator)}</span>
        </div>
      </div>
    </Link>
  );
}
