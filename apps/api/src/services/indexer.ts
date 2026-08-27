/**
 * Contract-state indexer.
 *
 * GenVM Intelligent Contracts don't expose a subscribable EVM-style event
 * log the way a normal Solidity contract would (there's no `Transfer`/
 * custom-event stream to tail) — see the module docstring in
 * contracts/proof_bounty.py, "GENLAYER AS REFEREE" and builder-resources.md
 * both point at polling the contract's own view methods as the supported
 * pattern for this. So this indexer polls on an interval:
 *
 *   1. `list_bounties(0, 200)` -> upsert every bounty row.
 *   2. For every bounty with `attempt_count > 0`, `get_bounty_attempts` ->
 *      upsert every attempt row.
 *   3. `get_reputation` for every distinct creator/challenger address seen.
 *   4. Diff each poll's fetched state against what was previously cached to
 *      synthesize `ActivityEvent` rows (the activity feed PROOFBOUNTY.md
 *      section 42 asks for) — this is reconstructed from state deltas
 *      since there is no native event stream to read it from directly.
 *
 * This cache is NEVER authoritative — see the schema.prisma header comment
 * and PROOFBOUNTY.md section 30. If it and the contract ever disagree, the
 * frontend should trust a direct contract read over this API for anything
 * that will drive a financial decision (e.g. accepting a bounty); this API
 * exists for fast search/filter/activity, not as a payment-critical path.
 */

import { prisma } from "../lib/prisma.js";
import { readContract } from "../lib/genlayer.js";
import { env } from "../lib/env.js";
import { archiveEvidence } from "./evidence-archiver.js";

interface BountyRow {
  bounty_id: number;
  creator: string;
  arbiter: string;
  title: string;
  claim_text: string;
  claim_polarity: string;
  category: string;
  proof_criteria: string;
  evidence_requirements: string;
  status: number;
  status_label: string;
  reward_amount: number | string;
  reward_deposited: number | string;
  required_bond: number | string;
  platform_fee_bps: number;
  attempt_count: number;
  attempts_won: number;
  winning_attempt_index: number;
  criteria_locked: boolean;
  deadline: number;
  created_at: number;
}

interface AttemptRow {
  bounty_id: number;
  index: number;
  challenger: string;
  bond_amount: number | string;
  bond_deposited: number | string;
  status: number;
  status_label: string;
  evidence_url: string;
  evidence_description: string;
  revision_count: number;
  max_revisions: number;
  last_verdict: string;
  last_reasoning: string;
  last_payout_bps: number;
  evidence_content_hash: string;
  evidence_fetched_at: number;
  disputed_by: string;
  dispute_reason: string;
  pending_arbiter_verdict: string;
  pending_payout_bps: number;
  appeal_deadline: number;
  appealed_by: string;
  appeal_reason: string;
  appeal_bond_deposited: number | string;
  created_at: number;
  submitted_at: number;
  resolved_at: number;
  resolved_by_arbiter: boolean;
}

interface ReputationRow {
  address: string;
  bounties_created: number;
  bounties_funded_total: number | string;
  attempts_made: number;
  attempts_won: number;
  attempts_partial: number;
  attempts_rejected: number;
  attempts_disputed: number;
  total_earned: number | string;
}

let running = false;

export async function pollOnce(logger: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void }) {
  if (running) {
    logger.info({}, "indexer: previous poll still running, skipping this tick");
    return;
  }
  running = true;
  const startedAt = Date.now();
  const addressesSeen = new Set<string>();

  try {
    const bounties = await readContract<BountyRow[]>("list_bounties", [0, 200]);

    for (const b of bounties) {
      const previous = await prisma.bounty.findUnique({ where: { bountyId: b.bounty_id } });

      await prisma.bounty.upsert({
        where: { bountyId: b.bounty_id },
        create: mapBounty(b),
        update: mapBounty(b),
      });

      addressesSeen.add(b.creator.toLowerCase());

      if (!previous) {
        await logEvent(b.bounty_id, null, "BOUNTY_CREATED", b.creator, b.title);
      } else if (previous.statusLabel !== b.status_label) {
        const kind = statusChangeKind(b.status_label);
        await logEvent(b.bounty_id, null, kind, b.creator, b.status_label);
        await notify(
          b.creator,
          kind,
          b.bounty_id,
          null,
          `Bounty "${b.title}" is now ${b.status_label}`,
          statusChangeBody(b.status_label, b.title)
        );
      }

      if (b.attempt_count === 0) continue;

      // Cost-saving skip: if every cached attempt for this bounty is
      // already in a terminal per-attempt state (WON/LOST_RACE/
      // BOND_FORFEITED/CANCELLED) and the attempt count hasn't grown,
      // nothing about this bounty's attempts can have changed since the
      // last poll -- skip the read entirely. This matters a great deal at
      // scale: GenLayer's real 500-req/hour cap (hit live during testing,
      // see rate-limiter.ts) means every avoidable call counts. Not simply
      // gated on the BOUNTY's own status, though: a REJECTED_FINAL attempt
      // can still be disputed/forfeited after its bounty has already
      // SETTLED via a different attempt, so bounty-level terminality alone
      // is not a safe skip condition -- only attempt-level terminality is.
      const cachedAttempts = previous
        ? await prisma.attempt.findMany({ where: { bountyId: b.bounty_id } })
        : [];
      const allCachedTerminal =
        cachedAttempts.length > 0 &&
        cachedAttempts.length === b.attempt_count &&
        cachedAttempts.every((a) =>
          ["WON", "LOST_RACE", "BOND_FORFEITED", "CANCELLED"].includes(a.statusLabel)
        );
      if (allCachedTerminal) continue;

      const attempts = await readContract<AttemptRow[]>("get_bounty_attempts", [b.bounty_id]);
      for (const a of attempts) {
        addressesSeen.add(a.challenger.toLowerCase());

        const previousAttempt = await prisma.attempt.findUnique({
          where: { bountyId_attemptIndex: { bountyId: b.bounty_id, attemptIndex: a.index } },
        });

        await prisma.attempt.upsert({
          where: { bountyId_attemptIndex: { bountyId: b.bounty_id, attemptIndex: a.index } },
          create: mapAttempt(a),
          update: mapAttempt(a),
        });

        if (!previousAttempt) {
          await logEvent(b.bounty_id, a.index, "ATTEMPT_ACCEPTED", a.challenger, null);
          await notify(
            b.creator,
            "ATTEMPT_ACCEPTED",
            b.bounty_id,
            a.index,
            `New attempt on "${b.title}"`,
            `${shortAddr(a.challenger)} accepted your bounty and locked a bond.`
          );
        } else if (previousAttempt.statusLabel !== a.status_label) {
          const kind = attemptStatusChangeKind(a.status_label);
          await logEvent(b.bounty_id, a.index, kind, a.challenger, a.last_verdict || a.status_label);
          for (const [recipient, title, body] of attemptRecipients(kind, b, a)) {
            await notify(recipient, kind, b.bounty_id, a.index, title, body);
          }
          // Independent evidence archival (real SHA-256, real stored
          // content — see evidence-archiver.ts) fires the moment evidence
          // is submitted, not just when a verdict lands: this way even
          // evidence for an attempt that later gets a NEEDS_REVISION /
          // INSUFFICIENT_EVIDENCE / REJECTED verdict is preserved, not
          // only the winning submission. Fire-and-forget — archival is a
          // best-effort provenance layer, never allowed to block or fail
          // the indexer's own poll loop.
          if (kind === "EVIDENCE_SUBMITTED" && a.evidence_url) {
            archiveEvidence(b.bounty_id, a.index, a.evidence_url).catch((err) => {
              logger.error({ bountyId: b.bounty_id, attemptIndex: a.index, err }, "evidence archival failed");
            });
          }
        }
        // A second, independent archival pass: fires specifically when
        // the contract's own `evidence_content_hash` newly appears or
        // changes on this attempt (i.e. `request_verification` just ran
        // and validators fetched the page themselves). This snapshot
        // lands much closer in time to the moment validators evaluated
        // the page than the EVIDENCE_SUBMITTED one above -- narrowing,
        // though not eliminating, the gap an audit correctly flagged:
        // this archive is still a SEPARATE fetch, not literally the bytes
        // validators saw, since GenVM does not expose that content back
        // to the contract or this backend. `localContentDigest` is
        // compared against the on-chain hash on write specifically so
        // that gap stays observable rather than assumed away -- see
        // evidence-archiver.ts and schema.prisma's onChainHashMatch field.
        if (
          a.evidence_content_hash &&
          a.evidence_content_hash !== previousAttempt?.evidenceContentHash &&
          a.evidence_url
        ) {
          archiveEvidence(b.bounty_id, a.index, a.evidence_url).catch((err) => {
            logger.error(
              { bountyId: b.bounty_id, attemptIndex: a.index, err },
              "post-verification evidence archival failed"
            );
          });
        }
      }
    }

    for (const address of addressesSeen) {
      try {
        const rep = await readContract<ReputationRow>("get_reputation", [address]);
        await prisma.reputation.upsert({
          where: { address: rep.address.toLowerCase() },
          create: mapReputation(rep),
          update: mapReputation(rep),
        });
      } catch (err) {
        logger.error({ address, err }, "indexer: failed to sync reputation for address");
      }
    }

    await prisma.indexerState.upsert({
      where: { id: 1 },
      create: { id: 1, lastBountyCount: bounties.length, lastPolledAt: new Date(), lastError: null },
      update: { lastBountyCount: bounties.length, lastPolledAt: new Date(), lastError: null },
    });

    logger.info(
      { bounties: bounties.length, addressesSeen: addressesSeen.size, ms: Date.now() - startedAt },
      "indexer: poll complete"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "indexer: poll failed");
    await prisma.indexerState.upsert({
      where: { id: 1 },
      create: { id: 1, lastBountyCount: 0, lastPolledAt: new Date(), lastError: message },
      update: { lastPolledAt: new Date(), lastError: message },
    });
  } finally {
    running = false;
  }
}

export function startIndexer(logger: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void }) {
  // Fire immediately, then on the configured interval — always-on
  // (PROOFBOUNTY.md requirement), so this loop must never throw out of
  // `pollOnce` uncaught; every failure path above is caught and recorded.
  pollOnce(logger);
  return setInterval(() => pollOnce(logger), env.INDEXER_POLL_INTERVAL_MS);
}

async function logEvent(bountyId: number, attemptIndex: number | null, kind: string, actor: string | null, detail: string | null) {
  await prisma.activityEvent.create({
    data: { bountyId, attemptIndex, kind, actor, detail },
  });
}

function shortAddr(addr: string): string {
  return addr && addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

async function notify(
  recipient: string,
  kind: string,
  bountyId: number,
  attemptIndex: number | null,
  title: string,
  body: string
) {
  if (!recipient) return;
  await prisma.notification.create({
    data: { recipient: recipient.toLowerCase(), kind, bountyId, attemptIndex, title, body },
  });
}

function statusChangeBody(statusLabel: string, title: string): string {
  switch (statusLabel) {
    case "SETTLED":
      return `Your bounty "${title}" has settled.`;
    case "CANCELLED":
      return `Your bounty "${title}" was cancelled and refunded.`;
    case "EXPIRED_REFUNDED":
      return `Your bounty "${title}" expired with no winner and was refunded to you.`;
    default:
      return `Your bounty "${title}" changed status to ${statusLabel}.`;
  }
}

/**
 * Who should be notified about an attempt-level status change, and what
 * to tell them. Returns [recipient, title, body] tuples -- an event can
 * fan out to more than one interested party (e.g. an arbiter ruling
 * concerns both the creator and the challenger).
 */
function attemptRecipients(
  kind: string,
  bounty: BountyRow,
  attempt: AttemptRow
): [string, string, string][] {
  const who = shortAddr(attempt.challenger);
  switch (kind) {
    case "EVIDENCE_SUBMITTED":
      return [[bounty.creator, `Evidence submitted on "${bounty.title}"`, `${who} submitted evidence for review.`]];
    case "VERDICT_RECEIVED":
      return [
        [
          attempt.challenger,
          `Verdict on "${bounty.title}": ${attempt.last_verdict || attempt.status_label}`,
          attempt.last_reasoning || `Your attempt reached ${attempt.status_label}.`,
        ],
        ...(attempt.status_label === "WON"
          ? ([[bounty.creator, `"${bounty.title}" has been won`, `${who}'s evidence was accepted and the reward was paid out.`]] as [string, string, string][])
          : []),
      ];
    case "SETTLED": // LOST_RACE
      return [[attempt.challenger, `You lost the race on "${bounty.title}"`, `Another attempt won first — reclaim your bond.`]];
    case "DISPUTE_RESOLVED": // BOND_FORFEITED
      return [[attempt.challenger, `Bond forfeited on "${bounty.title}"`, `Your bond was forfeited after a final rejection.`]];
    case "DISPUTED":
      return [
        [bounty.arbiter, `Dispute raised on "${bounty.title}"`, `A dispute needs your ruling as arbiter.`],
        [bounty.creator, `Dispute raised on "${bounty.title}"`, `An attempt on your bounty was disputed.`],
        [attempt.challenger, `Dispute raised on "${bounty.title}"`, `Your attempt was disputed.`],
      ];
    case "ARBITER_RULED":
      return [
        [bounty.creator, `Arbiter ruled on "${bounty.title}"`, `The arbiter ruled ${attempt.last_verdict}. Appeal window is open.`],
        [attempt.challenger, `Arbiter ruled on "${bounty.title}"`, `The arbiter ruled ${attempt.last_verdict}. Appeal window is open.`],
      ];
    case "APPEALED":
      return [
        [bounty.creator, `Appeal raised on "${bounty.title}"`, `The arbiter's ruling was appealed and awaits the protocol owner's final call.`],
        [attempt.challenger, `Appeal raised on "${bounty.title}"`, `The arbiter's ruling was appealed and awaits the protocol owner's final call.`],
      ];
    default:
      return [];
  }
}

function statusChangeKind(statusLabel: string): string {
  if (statusLabel === "SETTLED") return "SETTLED";
  if (statusLabel === "CANCELLED") return "CANCELLED";
  if (statusLabel === "EXPIRED_REFUNDED") return "EXPIRED_REFUNDED";
  return "BOUNTY_STATUS_CHANGED";
}

function attemptStatusChangeKind(statusLabel: string): string {
  switch (statusLabel) {
    case "SUBMITTED":
      return "EVIDENCE_SUBMITTED";
    case "WON":
      return "VERDICT_RECEIVED";
    case "REJECTED_FINAL":
      return "VERDICT_RECEIVED";
    case "NEEDS_REVISION":
      return "VERDICT_RECEIVED";
    case "DISPUTED":
      return "DISPUTED";
    case "LOST_RACE":
      return "SETTLED";
    case "BOND_FORFEITED":
      return "DISPUTE_RESOLVED";
    case "ARBITER_RESOLVED_PENDING_APPEAL":
      return "ARBITER_RULED";
    case "APPEALED":
      return "APPEALED";
    default:
      return "ATTEMPT_STATUS_CHANGED";
  }
}

function mapBounty(b: BountyRow) {
  return {
    bountyId: b.bounty_id,
    creator: b.creator,
    arbiter: b.arbiter,
    title: b.title,
    claimText: b.claim_text,
    claimPolarity: b.claim_polarity,
    category: b.category,
    proofCriteria: b.proof_criteria,
    evidenceRequirements: b.evidence_requirements,
    status: b.status,
    statusLabel: b.status_label,
    rewardAmount: String(b.reward_amount),
    rewardDeposited: String(b.reward_deposited),
    requiredBond: String(b.required_bond),
    platformFeeBps: b.platform_fee_bps,
    attemptCount: b.attempt_count,
    attemptsWon: b.attempts_won,
    winningAttemptIndex: b.winning_attempt_index,
    criteriaLocked: b.criteria_locked,
    deadline: b.deadline,
    createdAt: b.created_at,
  };
}

function mapAttempt(a: AttemptRow) {
  return {
    bountyId: a.bounty_id,
    attemptIndex: a.index,
    challenger: a.challenger,
    bondAmount: String(a.bond_amount),
    bondDeposited: String(a.bond_deposited),
    status: a.status,
    statusLabel: a.status_label,
    evidenceUrl: a.evidence_url,
    evidenceDescription: a.evidence_description,
    revisionCount: a.revision_count,
    maxRevisions: a.max_revisions,
    lastVerdict: a.last_verdict,
    lastReasoning: a.last_reasoning,
    lastPayoutBps: a.last_payout_bps,
    evidenceContentHash: a.evidence_content_hash,
    evidenceFetchedAt: a.evidence_fetched_at,
    disputedBy: a.disputed_by,
    disputeReason: a.dispute_reason,
    pendingArbiterVerdict: a.pending_arbiter_verdict,
    pendingPayoutBps: a.pending_payout_bps,
    appealDeadline: a.appeal_deadline,
    appealedBy: a.appealed_by,
    appealReason: a.appeal_reason,
    appealBondDeposited: String(a.appeal_bond_deposited),
    createdAt: a.created_at,
    submittedAt: a.submitted_at,
    resolvedAt: a.resolved_at,
    resolvedByArbiter: a.resolved_by_arbiter,
  };
}

function mapReputation(r: ReputationRow) {
  return {
    address: r.address.toLowerCase(),
    bountiesCreated: r.bounties_created,
    bountiesFundedTotal: String(r.bounties_funded_total),
    attemptsMade: r.attempts_made,
    attemptsWon: r.attempts_won,
    attemptsPartial: r.attempts_partial,
    attemptsRejected: r.attempts_rejected,
    attemptsDisputed: r.attempts_disputed,
    totalEarned: String(r.total_earned),
  };
}
