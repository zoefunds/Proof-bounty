import clsx from "clsx";

/**
 * Renders a bounty/attempt status label with the color mapping defined in
 * DESIGN.md's "Status Colors" section — Approved/Won = Action Green,
 * Partial = gold, Rejected = rose, Disputed = orange, everything else
 * neutral slate.
 */

const STATUS_COLOR: Record<string, string> = {
  OPEN: "text-electric-blue border-electric-blue/40 bg-electric-blue/10",
  ACCEPTED: "text-electric-blue border-electric-blue/40 bg-electric-blue/10",
  SUBMITTED: "text-status-partial border-status-partial/40 bg-status-partial/10",
  NEEDS_REVISION: "text-status-partial border-status-partial/40 bg-status-partial/10",
  SETTLED: "text-status-approved border-status-approved/40 bg-status-approved/10",
  WON: "text-status-approved border-status-approved/40 bg-status-approved/10",
  PARTIAL: "text-status-partial border-status-partial/40 bg-status-partial/10",
  REJECTED_FINAL: "text-status-rejected border-status-rejected/40 bg-status-rejected/10",
  BOND_FORFEITED: "text-status-rejected border-status-rejected/40 bg-status-rejected/10",
  CANCELLED: "text-on-surface-variant border-border-subtle bg-surface-container",
  EXPIRED_REFUNDED: "text-on-surface-variant border-border-subtle bg-surface-container",
  LOST_RACE: "text-on-surface-variant border-border-subtle bg-surface-container",
  DISPUTED: "text-status-disputed border-status-disputed/40 bg-status-disputed/10",
  ARBITER_RESOLVED_PENDING_APPEAL: "text-status-partial border-status-partial/40 bg-status-partial/10",
  APPEALED: "text-status-disputed border-status-disputed/40 bg-status-disputed/10",
  INSUFFICIENT_EVIDENCE_FINAL: "text-on-surface-variant border-border-subtle bg-surface-container",
};

export function StatusPill({ status }: { status: string }) {
  const colorClass = STATUS_COLOR[status] ?? "text-on-surface-variant border-border-subtle bg-surface-container";
  const isLive = status === "OPEN" || status === "ACCEPTED";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono-data text-[11px] tracking-wide uppercase",
        colorClass
      )}
    >
      {isLive && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}
