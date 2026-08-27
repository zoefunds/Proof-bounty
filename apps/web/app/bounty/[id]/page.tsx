"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useContractRead } from "@/lib/use-contract-read";
import { useContractWrite } from "@/lib/use-contract-write";
import { useWallet } from "@/lib/wallet-context";
import { formatGen, formatDeadline, formatTimestamp, truncateAddress, isExpired } from "@/lib/format";
import type { BountyDetail, AttemptDetail } from "@/lib/types";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { TxStateBanner } from "@/components/ui/TxStateBanner";
import { AttemptCard } from "@/components/bounty/AttemptCard";

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const bountyId = Number(params.id);
  const { address } = useWallet();

  const { data: bounty, isLoading, error, refetch } = useContractRead<BountyDetail>("get_bounty", [
    bountyId,
  ]);
  const { data: attempts, refetch: refetchAttempts } = useContractRead<AttemptDetail[]>(
    "get_bounty_attempts",
    [bountyId],
    { enabled: !!bounty }
  );

  function refreshAll() {
    refetch();
    refetchAttempts();
  }

  if (isLoading) {
    return <div className="max-w-[1280px] mx-auto w-full px-4 md:px-16 py-16 font-body text-on-surface-variant">Loading bounty...</div>;
  }
  if (error || !bounty) {
    return (
      <div className="max-w-[1280px] mx-auto w-full px-4 md:px-16 py-16 font-body text-status-rejected">
        Could not load bounty #{bountyId}: {error ?? "not found"}
      </div>
    );
  }

  const expired = isExpired(bounty.deadline);
  const displayStatus = bounty.status_label === "OPEN" && expired ? "EXPIRED_REFUNDED" : bounty.status_label;
  const isCreator = address?.toLowerCase() === bounty.creator.toLowerCase();
  const canAccept = bounty.status_label === "OPEN" && !expired && !isCreator;
  const canCancel = isCreator && bounty.status_label === "OPEN" && !bounty.criteria_locked;
  const canClaimTimeout = isCreator && bounty.status_label === "OPEN" && expired;

  return (
    <main className="flex-grow pt-8 pb-24 px-4 md:px-16 max-w-[1280px] mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 flex flex-col gap-6">
        {/* Header card */}
        <div className="glass-panel rounded-xl p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4">
            <StatusPill status={displayStatus} />
          </div>
          <span className="inline-block px-2 py-1 bg-surface-container-highest rounded text-[10px] font-bold tracking-wider text-action-green uppercase font-mono-data mb-4">
            {bounty.category.replace(/_/g, " ")} · {bounty.claim_polarity}
          </span>
          <h1 className="font-headline text-3xl md:text-4xl text-on-surface mb-2 pr-24">{bounty.title}</h1>
          <p className="font-body text-lg text-on-surface-variant mb-6">{bounty.claim_text}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 border-t border-border-subtle pt-6">
            <Stat label="Reward" value={`${formatGen(bounty.reward_amount)} GEN`} accent="action-green" />
            <Stat label="Bond Required" value={`${formatGen(bounty.required_bond)} GEN`} accent="tertiary-fixed-dim" />
            <Stat label="Deadline" value={formatTimestamp(bounty.deadline)} mono />
            <Stat label="Creator" value={truncateAddress(bounty.creator)} mono accentText="electric-blue" />
          </div>
        </div>

        {/* Proof criteria */}
        <div className="glass-panel rounded-xl p-8">
          <h2 className="font-headline text-xl text-on-surface mb-4">Precommitted Proof Criteria</h2>
          <p className="font-body text-sm text-on-surface-variant whitespace-pre-wrap leading-relaxed">
            {bounty.proof_criteria}
          </p>
          {bounty.criteria_locked && (
            <p className="font-mono-data text-[11px] text-action-green mt-4">
              🔒 Locked — immutable since the first attempt was accepted.
            </p>
          )}
        </div>

        {/* Evidence requirements */}
        <div className="glass-panel rounded-xl p-8">
          <h2 className="font-headline text-xl text-on-surface mb-4">Evidence Requirements</h2>
          <p className="font-body text-sm text-on-surface-variant whitespace-pre-wrap leading-relaxed">
            {bounty.evidence_requirements || "No specific format required — any publicly accessible URL."}
          </p>
        </div>

        {/* Attempts */}
        <div className="glass-panel rounded-xl p-8">
          <h2 className="font-headline text-xl text-on-surface mb-6">
            Attempts ({attempts?.length ?? 0})
          </h2>
          {!attempts || attempts.length === 0 ? (
            <p className="font-body text-sm text-on-surface-variant">
              No one has attempted this bounty yet.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {attempts.map((attempt) => (
                <AttemptCard key={attempt.index} bounty={bounty} attempt={attempt} onChanged={refreshAll} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right column */}
      <div className="lg:col-span-4 flex flex-col gap-6">
        <div className="glass-panel rounded-xl p-6 border-t-4 border-t-action-green">
          <h3 className="font-headline text-xl text-on-surface mb-2">
            {canAccept ? "Ready to prove it?" : "Bounty Actions"}
          </h3>
          <BountyActionPanel
            bounty={bounty}
            canAccept={canAccept}
            canCancel={canCancel}
            canClaimTimeout={canClaimTimeout}
            onChanged={refreshAll}
          />
        </div>

        <div className="glass-panel rounded-xl p-6">
          <h3 className="font-body font-bold text-sm uppercase tracking-wider text-on-surface mb-4">
            Arbiter
          </h3>
          <p className="font-mono-data text-xs text-electric-blue break-all">{bounty.arbiter}</p>
          <p className="font-body text-xs text-on-surface-variant mt-2">
            Resolves disputes on this bounty&apos;s attempts if the AI verdict is contested.
          </p>
        </div>

        <div className="glass-panel rounded-xl p-6">
          <h3 className="font-body font-bold text-sm uppercase tracking-wider text-on-surface mb-4">
            Timeline
          </h3>
          <div className="flex flex-col gap-3 font-body text-xs text-on-surface-variant">
            <div>Created {formatTimestamp(bounty.created_at)}</div>
            <div>Deadline {formatTimestamp(bounty.deadline)} ({formatDeadline(bounty.deadline)})</div>
            <div>{bounty.attempt_count} total attempt{bounty.attempt_count === 1 ? "" : "s"}</div>
          </div>
        </div>
      </div>
    </main>
  );
}

const STAT_COLOR_CLASS = {
  "action-green": "text-action-green",
  "tertiary-fixed-dim": "text-tertiary-fixed-dim",
  "electric-blue": "text-electric-blue",
  default: "text-on-surface",
} as const;

function Stat({
  label,
  value,
  accent,
  accentText,
  mono,
}: {
  label: string;
  value: string;
  accent?: keyof typeof STAT_COLOR_CLASS;
  accentText?: keyof typeof STAT_COLOR_CLASS;
  mono?: boolean;
}) {
  const colorClass = STAT_COLOR_CLASS[accent ?? accentText ?? "default"];
  return (
    <div>
      <div className="font-mono-data text-[10px] text-on-surface-variant mb-1 uppercase">{label}</div>
      <div className={`font-headline text-xl ${mono ? "font-mono-data text-sm" : ""} ${colorClass}`}>
        {value}
      </div>
    </div>
  );
}

function BountyActionPanel({
  bounty,
  canAccept,
  canCancel,
  canClaimTimeout,
  onChanged,
}: {
  bounty: BountyDetail;
  canAccept: boolean;
  canCancel: boolean;
  canClaimTimeout: boolean;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const acceptTx = useContractWrite();
  const cancelTx = useContractWrite();
  const timeoutTx = useContractWrite();
  const [confirming, setConfirming] = useState(false);

  async function handleAccept() {
    const ok = await acceptTx.write({
      functionName: "accept_bounty",
      args: [bounty.bounty_id],
      value: BigInt(bounty.required_bond || 0),
    });
    if (ok) onChanged();
  }

  async function handleCancel() {
    const ok = await cancelTx.write({ functionName: "cancel_bounty", args: [bounty.bounty_id] });
    if (ok) onChanged();
  }

  async function handleTimeout() {
    const ok = await timeoutTx.write({ functionName: "claim_creator_timeout", args: [bounty.bounty_id] });
    if (ok) onChanged();
  }

  if (!address) {
    return <p className="font-body text-sm text-on-surface-variant">Connect your wallet to interact with this bounty.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {canAccept && (
        <>
          <p className="font-body text-sm text-on-surface-variant mb-2">
            Lock {formatGen(bounty.required_bond)} GEN as your performance bond to accept this challenge.
            If your evidence is rejected, the bond is forfeitable to the creator.
          </p>
          {!confirming ? (
            <Button onClick={() => setConfirming(true)}>Accept & Lock Bond</Button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="font-mono-data text-[11px] text-status-partial">
                Confirm: lock exactly {formatGen(bounty.required_bond)} GEN?
              </p>
              <div className="flex gap-2">
                <Button onClick={handleAccept} isLoading={acceptTx.isBusy}>
                  Confirm
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <TxStateBanner state={acceptTx.state} txHash={acceptTx.txHash} errorMessage={acceptTx.errorMessage} />
        </>
      )}
      {canCancel && (
        <>
          <p className="font-body text-sm text-on-surface-variant mb-2">
            No one has accepted this bounty yet — you may cancel and reclaim your full reward.
          </p>
          <Button variant="danger" onClick={handleCancel} isLoading={cancelTx.isBusy}>
            Cancel & Refund
          </Button>
          <TxStateBanner state={cancelTx.state} txHash={cancelTx.txHash} errorMessage={cancelTx.errorMessage} />
        </>
      )}
      {canClaimTimeout && (
        <>
          <p className="font-body text-sm text-on-surface-variant mb-2">
            The deadline has passed with no winning attempt — reclaim your reward.
          </p>
          <Button onClick={handleTimeout} isLoading={timeoutTx.isBusy}>
            Claim Timeout Refund
          </Button>
          <TxStateBanner state={timeoutTx.state} txHash={timeoutTx.txHash} errorMessage={timeoutTx.errorMessage} />
        </>
      )}
      {!canAccept && !canCancel && !canClaimTimeout && (
        <p className="font-body text-sm text-on-surface-variant">
          No actions available — see the attempts below for what&apos;s in progress.
        </p>
      )}
    </div>
  );
}
