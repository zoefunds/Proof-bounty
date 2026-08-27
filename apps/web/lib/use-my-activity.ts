"use client";

/**
 * Finds the connected wallet's own bounties/attempts.
 *
 * Fast path: query the backend indexer (apps/api) — a single indexed
 * lookup instead of scanning every bounty. Falls back to a client-side
 * scan across `list_bounties`/`get_bounty_attempts` if the backend is
 * unreachable (matches PROOFBOUNTY.md's requirement that the cache is
 * never a hard dependency — the app must keep working directly against
 * the contract if the indexer is down). Bounded by MAX_LISTING_SCAN (200)
 * on the contract side, so the fallback remains correct, just slower.
 */

import { useEffect, useState } from "react";
import { getReadOnlyClient, getContractAddress } from "./genlayer-client";
import { isContractConfigured } from "./contract-config";
import { api, isApiConfigured } from "./api-client";
import type { AttemptDetail, BountyDetail } from "./types";

interface MyActivity {
  myBounties: BountyDetail[];
  myAttempts: { bounty: BountyDetail; attempt: AttemptDetail }[];
  isLoading: boolean;
  error: string | null;
  usedFallback: boolean;
}

interface IndexedAttempt {
  bountyId: number;
  attemptIndex: number;
  challenger: string;
  bondAmount: string;
  bondDeposited: string;
  status: number;
  statusLabel: string;
  evidenceUrl: string;
  evidenceDescription: string;
  revisionCount: number;
  maxRevisions: number;
  lastVerdict: string;
  lastReasoning: string;
  lastPayoutBps: number;
  evidenceContentHash: string;
  evidenceFetchedAt: number;
  disputedBy: string;
  disputeReason: string;
  pendingArbiterVerdict: string;
  pendingPayoutBps: number;
  appealDeadline: number;
  appealedBy: string;
  appealReason: string;
  appealBondDeposited: string;
  createdAt: number;
  submittedAt: number;
  resolvedAt: number;
  resolvedByArbiter: boolean;
  bounty: IndexedBounty;
}

interface IndexedBounty {
  bountyId: number;
  creator: string;
  arbiter: string;
  title: string;
  claimText: string;
  claimPolarity: string;
  category: string;
  proofCriteria: string;
  evidenceRequirements: string;
  status: number;
  statusLabel: string;
  rewardAmount: string;
  rewardDeposited: string;
  requiredBond: string;
  platformFeeBps: number;
  attemptCount: number;
  attemptsWon: number;
  winningAttemptIndex: number;
  criteriaLocked: boolean;
  deadline: number;
  createdAt: number;
}

function toBountyDetail(b: IndexedBounty): BountyDetail {
  return {
    bounty_id: b.bountyId,
    creator: b.creator,
    arbiter: b.arbiter,
    title: b.title,
    claim_text: b.claimText,
    claim_polarity: b.claimPolarity as "POSITIVE" | "NEGATIVE",
    category: b.category,
    proof_criteria: b.proofCriteria,
    evidence_requirements: b.evidenceRequirements,
    status: b.status,
    status_label: b.statusLabel,
    reward_amount: b.rewardAmount,
    reward_deposited: b.rewardDeposited,
    required_bond: b.requiredBond,
    platform_fee_bps: b.platformFeeBps,
    attempt_count: b.attemptCount,
    attempts_won: b.attemptsWon,
    winning_attempt_index: b.winningAttemptIndex,
    criteria_locked: b.criteriaLocked,
    deadline: b.deadline,
    created_at: b.createdAt,
  };
}

function toAttemptDetail(a: IndexedAttempt): AttemptDetail {
  return {
    bounty_id: a.bountyId,
    index: a.attemptIndex,
    challenger: a.challenger,
    bond_amount: a.bondAmount,
    bond_deposited: a.bondDeposited,
    status: a.status,
    status_label: a.statusLabel,
    evidence_url: a.evidenceUrl,
    evidence_description: a.evidenceDescription,
    revision_count: a.revisionCount,
    max_revisions: a.maxRevisions,
    last_verdict: a.lastVerdict,
    last_reasoning: a.lastReasoning,
    last_payout_bps: a.lastPayoutBps,
    evidence_content_hash: a.evidenceContentHash,
    evidence_fetched_at: a.evidenceFetchedAt,
    disputed_by: a.disputedBy,
    dispute_reason: a.disputeReason,
    pending_arbiter_verdict: a.pendingArbiterVerdict,
    pending_payout_bps: a.pendingPayoutBps,
    appeal_deadline: a.appealDeadline,
    appealed_by: a.appealedBy,
    appeal_reason: a.appealReason,
    appeal_bond_deposited: a.appealBondDeposited,
    created_at: a.createdAt,
    submitted_at: a.submittedAt,
    resolved_at: a.resolvedAt,
    resolved_by_arbiter: a.resolvedByArbiter,
  };
}

export function useMyActivity(address: string | null): MyActivity {
  const [myBounties, setMyBounties] = useState<BountyDetail[]>([]);
  const [myAttempts, setMyAttempts] = useState<{ bounty: BountyDetail; attempt: AttemptDetail }[]>([]);
  const [isLoading, setIsLoading] = useState(!!address);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    async function runFast(addr: string) {
      const [bountiesRes, attemptsRes] = await Promise.all([
        api.listBounties({ creator: addr, limit: 100 }),
        api.getAttemptsByChallenger(addr),
      ]);
      const bounties = (bountiesRes.items as IndexedBounty[]).map(toBountyDetail);
      const attempts = (attemptsRes.items as IndexedAttempt[]).map((a) => ({
        bounty: toBountyDetail(a.bounty),
        attempt: toAttemptDetail(a),
      }));
      return { bounties, attempts };
    }

    async function runFallback(addr: string) {
      const client = getReadOnlyClient();
      const addressLc = addr.toLowerCase();
      const bounties = (await client.readContract({
        address: getContractAddress(),
        functionName: "list_bounties",
        args: [0, 200],
      })) as unknown as BountyDetail[];

      const mine = bounties.filter((b) => b.creator.toLowerCase() === addressLc);
      const attemptResults: { bounty: BountyDetail; attempt: AttemptDetail }[] = [];
      for (const bounty of bounties) {
        if (bounty.attempt_count === 0) continue;
        const attempts = (await client.readContract({
          address: getContractAddress(),
          functionName: "get_bounty_attempts",
          args: [bounty.bounty_id],
        })) as unknown as AttemptDetail[];
        for (const attempt of attempts) {
          if (attempt.challenger.toLowerCase() === addressLc) {
            attemptResults.push({ bounty, attempt });
          }
        }
      }
      return { bounties: mine, attempts: attemptResults };
    }

    async function run() {
      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }
      try {
        let result;
        if (isApiConfigured()) {
          try {
            result = await runFast(address!);
          } catch {
            if (!isContractConfigured()) throw new Error("Backend unreachable and contract not configured.");
            result = await runFallback(address!);
            if (!cancelled) setUsedFallback(true);
          }
        } else {
          if (!isContractConfigured()) throw new Error("Contract not configured.");
          result = await runFallback(address!);
          if (!cancelled) setUsedFallback(true);
        }

        if (!cancelled) {
          setMyBounties(result.bounties);
          setMyAttempts(result.attempts);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { myBounties, myAttempts, isLoading, error, usedFallback };
}
