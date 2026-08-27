"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { useContractWrite } from "@/lib/use-contract-write";
import { useNow } from "@/lib/use-now";
import { formatGen, truncateAddress, formatTimestamp, bpsToPercent } from "@/lib/format";
import { toGenWei } from "@/lib/format";
import { api, isApiConfigured, type EvidenceArchiveItem } from "@/lib/api-client";
import type { AttemptDetail, BountyDetail } from "@/lib/types";
import { StatusPill } from "../ui/StatusPill";
import { Button } from "../ui/Button";
import { GlassInput, GlassTextarea, Label } from "../ui/Card";
import { TxStateBanner } from "../ui/TxStateBanner";

/**
 * Independent, off-chain evidence archive status for one attempt (see
 * apps/api/src/services/evidence-archiver.ts). Shows whether the
 * backend's own re-fetched, real-SHA-256-hashed copy's FNV-1a fingerprint
 * matches the on-chain `evidence_content_hash` -- a mismatch is EXPECTED
 * for markup-heavy pages (GenVM's fetch strips HTML, this archive stores
 * raw HTTP body) and is not itself proof of tampering; this exists to
 * make that gap observable, not to claim it's fully closed. Gracefully
 * renders nothing if the backend is unreachable or nothing has been
 * archived yet.
 */
function EvidenceArchiveStatus({ bountyId, attemptIndex }: { bountyId: number; attemptIndex: number }) {
  const [archives, setArchives] = useState<EvidenceArchiveItem[]>([]);

  useEffect(() => {
    if (!isApiConfigured()) return;
    let cancelled = false;
    api
      .getEvidenceArchives(bountyId, attemptIndex)
      .then((res) => {
        if (!cancelled) setArchives(res.items);
      })
      .catch(() => {
        // Backend unreachable or nothing archived yet — fail silently,
        // this is a supplementary provenance display, never a hard dependency.
      });
    return () => {
      cancelled = true;
    };
  }, [bountyId, attemptIndex]);

  if (archives.length === 0) return null;
  const latest = archives[0];

  return (
    <div className="mt-2 pt-2 border-t border-border-subtle">
      <div className="font-mono-data text-[9px] text-on-surface-variant uppercase tracking-wide">
        Independent off-chain archive
      </div>
      <div className="font-mono-data text-[10px] text-on-surface-variant break-all">
        SHA-256: {latest.contentSha256.slice(0, 24)}… ({latest.byteLength.toLocaleString()} bytes, fetched{" "}
        {new Date(latest.fetchedAt).toLocaleString()})
      </div>
      {latest.onChainHashMatch === true && (
        <div className="font-mono-data text-[9px] text-status-approved mt-1">
          ✓ matches the on-chain evidence fingerprint
        </div>
      )}
      {latest.onChainHashMatch === false && (
        <div className="font-mono-data text-[9px] text-status-partial mt-1">
          ⚠ differs from the on-chain fingerprint — expected for markup-heavy pages (this archive
          stores raw HTML; the contract&apos;s fetch strips it to plain text), not necessarily tampering
        </div>
      )}
      {latest.onChainHashMatch === null && (
        <div className="font-mono-data text-[9px] text-on-surface-variant mt-1">
          on-chain fingerprint not yet available for comparison
        </div>
      )}
      {archives.length > 1 && (
        <div className="font-mono-data text-[9px] text-on-surface-variant mt-1">
          +{archives.length - 1} earlier archived snapshot{archives.length - 1 > 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

export function AttemptCard({
  bounty,
  attempt,
  onChanged,
}: {
  bounty: BountyDetail;
  attempt: AttemptDetail;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const isChallenger = address?.toLowerCase() === attempt.challenger.toLowerCase();
  const isCreator = address?.toLowerCase() === bounty.creator.toLowerCase();
  const isArbiter = address?.toLowerCase() === bounty.arbiter.toLowerCase();
  // Owner-only actions (ResolveAppealForm) are gated contract-side, not
  // client-side -- we don't have a cheap client-side owner check here, and
  // a non-owner attempting resolve_appeal simply gets a clear tx rejection.

  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceDesc, setEvidenceDesc] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [appealReason, setAppealReason] = useState("");
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [showAppealForm, setShowAppealForm] = useState(false);

  const submitEvidenceTx = useContractWrite();
  const verifyTx = useContractWrite();
  const disputeTx = useContractWrite();
  const reclaimTx = useContractWrite();
  const forfeitTx = useContractWrite();
  const finalizeTx = useContractWrite();
  const appealTx = useContractWrite();

  const now = useNow();
  const appealWindowOpen =
    attempt.status_label === "ARBITER_RESOLVED_PENDING_APPEAL" && now < attempt.appeal_deadline;
  const appealWindowClosed =
    attempt.status_label === "ARBITER_RESOLVED_PENDING_APPEAL" && now >= attempt.appeal_deadline;

  const canSubmitEvidence =
    isChallenger && (attempt.status_label === "ACCEPTED" || attempt.status_label === "NEEDS_REVISION");
  const canRequestVerification = attempt.status_label === "SUBMITTED";
  const canDispute =
    (isChallenger || isCreator) &&
    ["ACCEPTED", "SUBMITTED", "NEEDS_REVISION", "REJECTED_FINAL"].includes(attempt.status_label);
  const canReclaim = isChallenger && attempt.status_label === "LOST_RACE";
  const canForfeit = isCreator && attempt.status_label === "REJECTED_FINAL";
  const canAppeal = (isChallenger || isCreator) && appealWindowOpen;
  const canFinalize = appealWindowClosed; // permissionless — anyone may call

  async function handleSubmitEvidence() {
    const ok = await submitEvidenceTx.write({
      functionName: "submit_evidence",
      args: [bounty.bounty_id, attempt.index, evidenceUrl, evidenceDesc],
    });
    if (ok) {
      setShowEvidenceForm(false);
      onChanged();
    }
  }

  async function handleRequestVerification() {
    const ok = await verifyTx.write({
      functionName: "request_verification",
      args: [bounty.bounty_id, attempt.index],
    });
    if (ok) onChanged();
  }

  async function handleDispute() {
    const ok = await disputeTx.write({
      functionName: "raise_dispute",
      args: [bounty.bounty_id, attempt.index, disputeReason],
    });
    if (ok) {
      setShowDisputeForm(false);
      onChanged();
    }
  }

  async function handleReclaim() {
    const ok = await reclaimTx.write({
      functionName: "reclaim_bond_after_settlement",
      args: [bounty.bounty_id, attempt.index],
    });
    if (ok) onChanged();
  }

  async function handleForfeit() {
    const ok = await forfeitTx.write({
      functionName: "claim_bond_forfeiture",
      args: [bounty.bounty_id, attempt.index],
    });
    if (ok) onChanged();
  }

  async function handleFinalize() {
    const ok = await finalizeTx.write({
      functionName: "finalize_arbiter_resolution",
      args: [bounty.bounty_id, attempt.index],
    });
    if (ok) onChanged();
  }

  async function handleAppeal() {
    const ok = await appealTx.write({
      functionName: "appeal_arbiter_resolution",
      args: [bounty.bounty_id, attempt.index, appealReason],
      value: toGenWei(String(Number(attempt.bond_amount) / 1e18)),
    });
    if (ok) {
      setShowAppealForm(false);
      onChanged();
    }
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-container-high p-4 flex flex-col gap-3">
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="font-mono-data text-xs text-electric-blue">{truncateAddress(attempt.challenger)}</div>
          <div className="font-body text-xs text-on-surface-variant mt-0.5">
            Attempt #{attempt.index} · bond {formatGen(attempt.bond_deposited || attempt.bond_amount)} GEN
          </div>
        </div>
        <StatusPill status={attempt.status_label} />
      </div>

      {attempt.evidence_url && (
        <div className="rounded bg-surface-container-lowest border border-border-subtle p-3">
          <div className="font-mono-data text-[10px] text-on-surface-variant uppercase tracking-wide mb-1">
            Evidence
          </div>
          <a
            href={attempt.evidence_url}
            target="_blank"
            rel="noreferrer"
            className="font-body text-sm text-electric-blue break-all hover:underline"
          >
            {attempt.evidence_url}
          </a>
          {attempt.evidence_description && (
            <p className="font-body text-xs text-on-surface-variant mt-2">{attempt.evidence_description}</p>
          )}
          {attempt.evidence_content_hash && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              <div className="font-mono-data text-[9px] text-on-surface-variant uppercase tracking-wide">
                Evidence manifest — fetched content fingerprint
              </div>
              <div className="font-mono-data text-[10px] text-status-approved break-all">
                {attempt.evidence_content_hash}
              </div>
              <div className="font-mono-data text-[9px] text-on-surface-variant">
                Judged at {formatTimestamp(attempt.evidence_fetched_at)} — a deterministic fingerprint of the
                exact page text every validator fetched and judged. Pair with an independent archive (Wayback
                Machine, IPFS) taken around this time to reconstruct what was actually proven.
              </div>
              <EvidenceArchiveStatus bountyId={attempt.bounty_id} attemptIndex={attempt.index} />
            </div>
          )}
        </div>
      )}

      {attempt.last_verdict && (
        <div className="rounded bg-surface-container-lowest border border-border-subtle p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono-data text-[10px] text-on-surface-variant uppercase tracking-wide">
              GenLayer Verdict
            </span>
            {attempt.last_payout_bps > 0 && (
              <span className="font-mono-data text-[10px] text-status-partial">
                {bpsToPercent(attempt.last_payout_bps)} payout
              </span>
            )}
          </div>
          <p className="font-body text-xs text-on-surface">{attempt.last_reasoning}</p>
        </div>
      )}

      {attempt.status_label === "DISPUTED" && (
        <div className="rounded bg-status-disputed/10 border border-status-disputed/30 p-3">
          <div className="font-mono-data text-[10px] text-status-disputed uppercase tracking-wide mb-1">
            Disputed by {truncateAddress(attempt.disputed_by)}
          </div>
          <p className="font-body text-xs text-on-surface">{attempt.dispute_reason}</p>
          {isArbiter && <ArbiterResolutionForm bounty={bounty} attempt={attempt} onChanged={onChanged} />}
        </div>
      )}

      {attempt.status_label === "ARBITER_RESOLVED_PENDING_APPEAL" && (
        <div className="rounded bg-status-partial/10 border border-status-partial/30 p-3">
          <div className="font-mono-data text-[10px] text-status-partial uppercase tracking-wide mb-1">
            Arbiter ruled: {attempt.pending_arbiter_verdict}
            {attempt.pending_payout_bps > 0 && ` (${bpsToPercent(attempt.pending_payout_bps)})`}
          </div>
          <p className="font-body text-xs text-on-surface mb-1">{attempt.last_reasoning}</p>
          <p className="font-mono-data text-[10px] text-on-surface-variant">
            {appealWindowOpen
              ? `Appeal window open until ${formatTimestamp(attempt.appeal_deadline)}`
              : "Appeal window closed — anyone can finalize this resolution now."}
          </p>
        </div>
      )}

      {attempt.status_label === "APPEALED" && (
        <div className="rounded bg-status-disputed/10 border border-status-disputed/30 p-3">
          <div className="font-mono-data text-[10px] text-status-disputed uppercase tracking-wide mb-1">
            Appealed by {truncateAddress(attempt.appealed_by)}
          </div>
          <p className="font-body text-xs text-on-surface mb-1">{attempt.appeal_reason}</p>
          <p className="font-mono-data text-[10px] text-on-surface-variant">
            Escalated to the protocol owner for a final ruling.
          </p>
          <ResolveAppealForm bounty={bounty} attempt={attempt} onChanged={onChanged} />
        </div>
      )}

      <div className="font-mono-data text-[10px] text-on-surface-variant">
        Submitted {formatTimestamp(attempt.submitted_at)} · revisions {attempt.revision_count}/
        {attempt.max_revisions}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        {canSubmitEvidence && !showEvidenceForm && (
          <Button size="sm" onClick={() => setShowEvidenceForm(true)}>
            Submit Evidence
          </Button>
        )}
        {canRequestVerification && (
          <Button size="sm" onClick={handleRequestVerification} isLoading={verifyTx.isBusy}>
            Request Verification
          </Button>
        )}
        {canReclaim && (
          <Button size="sm" variant="secondary" onClick={handleReclaim} isLoading={reclaimTx.isBusy}>
            Reclaim Bond
          </Button>
        )}
        {canForfeit && (
          <Button size="sm" variant="danger" onClick={handleForfeit} isLoading={forfeitTx.isBusy}>
            Claim Bond Forfeiture
          </Button>
        )}
        {canDispute && !showDisputeForm && (
          <Button size="sm" variant="ghost" onClick={() => setShowDisputeForm(true)}>
            Raise Dispute
          </Button>
        )}
        {canAppeal && !showAppealForm && (
          <Button size="sm" variant="danger" onClick={() => setShowAppealForm(true)}>
            Appeal Resolution
          </Button>
        )}
        {canFinalize && (
          <Button size="sm" onClick={handleFinalize} isLoading={finalizeTx.isBusy}>
            Finalize Resolution
          </Button>
        )}
      </div>

      {showEvidenceForm && (
        <div className="flex flex-col gap-3 pt-2 border-t border-border-subtle">
          <div>
            <Label>Evidence URL</Label>
            <GlassInput
              placeholder="https://..."
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
            />
          </div>
          <div>
            <Label>Description (context only — not judged directly)</Label>
            <GlassTextarea
              rows={2}
              placeholder="What does this evidence show?"
              value={evidenceDesc}
              onChange={(e) => setEvidenceDesc(e.target.value)}
            />
          </div>
          <TxStateBanner state={submitEvidenceTx.state} txHash={submitEvidenceTx.txHash} errorMessage={submitEvidenceTx.errorMessage} />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSubmitEvidence} isLoading={submitEvidenceTx.isBusy} disabled={!evidenceUrl}>
              Submit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowEvidenceForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showDisputeForm && (
        <div className="flex flex-col gap-3 pt-2 border-t border-border-subtle">
          <div>
            <Label>Dispute Reason</Label>
            <GlassTextarea
              rows={2}
              placeholder="Why do you believe the verdict was wrong?"
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
            />
          </div>
          <TxStateBanner state={disputeTx.state} txHash={disputeTx.txHash} errorMessage={disputeTx.errorMessage} />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={handleDispute} isLoading={disputeTx.isBusy} disabled={!disputeReason}>
              Raise Dispute
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowDisputeForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showAppealForm && (
        <div className="flex flex-col gap-3 pt-2 border-t border-border-subtle">
          <div>
            <Label>
              Appeal Reason — requires posting {formatGen(attempt.bond_amount)} GEN as an appeal bond, forfeited
              to the other party if the owner agrees with the arbiter
            </Label>
            <GlassTextarea
              rows={2}
              placeholder="Why was the arbiter's ruling wrong?"
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
            />
          </div>
          <TxStateBanner state={appealTx.state} txHash={appealTx.txHash} errorMessage={appealTx.errorMessage} />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={handleAppeal} isLoading={appealTx.isBusy} disabled={!appealReason}>
              Post Bond & Appeal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAppealForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(verifyTx.state !== "IDLE" && !showEvidenceForm) && (
        <TxStateBanner state={verifyTx.state} txHash={verifyTx.txHash} errorMessage={verifyTx.errorMessage} />
      )}
      {(reclaimTx.state !== "IDLE") && (
        <TxStateBanner state={reclaimTx.state} txHash={reclaimTx.txHash} errorMessage={reclaimTx.errorMessage} />
      )}
      {(forfeitTx.state !== "IDLE") && (
        <TxStateBanner state={forfeitTx.state} txHash={forfeitTx.txHash} errorMessage={forfeitTx.errorMessage} />
      )}
      {(finalizeTx.state !== "IDLE") && (
        <TxStateBanner state={finalizeTx.state} txHash={finalizeTx.txHash} errorMessage={finalizeTx.errorMessage} />
      )}
    </div>
  );
}

function ArbiterResolutionForm({
  bounty,
  attempt,
  onChanged,
}: {
  bounty: BountyDetail;
  attempt: AttemptDetail;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [partialPercent, setPartialPercent] = useState("50");
  const resolveTx = useContractWrite();

  async function resolve(verdict: "APPROVE" | "PARTIAL" | "REJECT") {
    // payout_bps is an explicit, separately-entered integer -- never
    // parsed out of the free-text note. The contract itself rejects
    // ambiguous/ freeform amounts for exactly this reason: a note that
    // happens to contain other digits must never be misread as the
    // payout split. See contracts/proof_bounty.py's resolve_dispute
    // docstring for the incident this replaced.
    //
    // Also note: this no longer pays out immediately. It opens an
    // appeal window (see the ARBITER_RESOLVED_PENDING_APPEAL banner
    // above) -- either party can appeal before it closes, or anyone can
    // finalize it afterward.
    const payoutBps = verdict === "PARTIAL" ? Math.round(Number(partialPercent) * 100) : 0;
    const ok = await resolveTx.write({
      functionName: "resolve_dispute",
      args: [bounty.bounty_id, attempt.index, verdict, note, payoutBps],
    });
    if (ok) onChanged();
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-status-disputed/20 pt-3">
      <Label>Resolution note (reasoning only — never used to compute payout)</Label>
      <GlassInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reasoning..." />
      <Label>Challenger&apos;s share, if PARTIAL (%)</Label>
      <GlassInput
        type="number"
        min="1"
        max="99"
        value={partialPercent}
        onChange={(e) => setPartialPercent(e.target.value)}
      />
      <p className="font-body text-[11px] text-on-surface-variant">
        This ruling opens a 2-day appeal window before it pays out — either party can appeal it.
      </p>
      <TxStateBanner state={resolveTx.state} txHash={resolveTx.txHash} errorMessage={resolveTx.errorMessage} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => resolve("APPROVE")} isLoading={resolveTx.isBusy}>
          Approve
        </Button>
        <Button size="sm" variant="secondary" onClick={() => resolve("PARTIAL")} isLoading={resolveTx.isBusy}>
          Partial
        </Button>
        <Button size="sm" variant="danger" onClick={() => resolve("REJECT")} isLoading={resolveTx.isBusy}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function ResolveAppealForm({
  bounty,
  attempt,
  onChanged,
}: {
  bounty: BountyDetail;
  attempt: AttemptDetail;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [partialPercent, setPartialPercent] = useState("50");
  const resolveAppealTx = useContractWrite();

  async function resolve(verdict: "APPROVE" | "PARTIAL" | "REJECT") {
    const payoutBps = verdict === "PARTIAL" ? Math.round(Number(partialPercent) * 100) : 0;
    const ok = await resolveAppealTx.write({
      functionName: "resolve_appeal",
      args: [bounty.bounty_id, attempt.index, verdict, note, payoutBps],
    });
    if (ok) onChanged();
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-status-disputed/20 pt-3">
      <p className="font-mono-data text-[10px] text-on-surface-variant uppercase tracking-wide">
        Protocol owner only — final ruling
      </p>
      <Label>Resolution note</Label>
      <GlassInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reasoning..." />
      <Label>Challenger&apos;s share, if PARTIAL (%)</Label>
      <GlassInput
        type="number"
        min="1"
        max="99"
        value={partialPercent}
        onChange={(e) => setPartialPercent(e.target.value)}
      />
      <p className="font-body text-[11px] text-on-surface-variant">
        The appeal bond returns to the appellant if this ruling differs from the arbiter&apos;s; otherwise it&apos;s
        forfeited to the other party.
      </p>
      <TxStateBanner state={resolveAppealTx.state} txHash={resolveAppealTx.txHash} errorMessage={resolveAppealTx.errorMessage} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => resolve("APPROVE")} isLoading={resolveAppealTx.isBusy}>
          Approve
        </Button>
        <Button size="sm" variant="secondary" onClick={() => resolve("PARTIAL")} isLoading={resolveAppealTx.isBusy}>
          Partial
        </Button>
        <Button size="sm" variant="danger" onClick={() => resolve("REJECT")} isLoading={resolveAppealTx.isBusy}>
          Reject
        </Button>
      </div>
    </div>
  );
}
