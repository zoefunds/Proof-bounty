# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""
PROOFBOUNTY -- an onchain marketplace for verifiable public claims,
settled by GenLayer's validator consensus against live, independently-
fetched web evidence.

======================================================================
WHY THIS NEEDS GENLAYER -- NOT A CENTRALIZED ORACLE, NOT A PLAIN LLM CALL
======================================================================

The core mechanic: a creator escrows GEN against a claim and a
precommitted, immutable set of proof criteria. A challenger stakes a
bond and points at a public URL as evidence. The contract itself fetches
that URL -- live, at verification time -- and every independent GenLayer
validator judges the FETCHED CONTENT (never the challenger's own
description of it) against the frozen criteria. Consensus on that
judgment is what releases the reward, refunds the bond, or forfeits it.

Three properties make this a genuinely bad fit for a centralized
service or a single off-chain LLM call, not just a stylistic preference
for "using GenLayer because it exists":

1. **The creator and challenger have directly opposed financial
   incentives on the same question.** The creator wants the claim to
   fail (keep the reward); the challenger wants it to pass (win the
   reward). Whoever operates the judge has a standing temptation to
   favor whichever side pays them, controls them, or can pressure them
   -- and neither party, nor a third company running a backend, can be
   that judge without the other side having a legitimate reason not to
   trust the result. GenLayer's validator set has no stake in either
   outcome and no single validator's answer is what pays out --
   `gl.eq_principle.prompt_comparative` requires independent agreement
   (see "AVOIDING UNDETERMINED / LEADER-ROTATION OUTCOMES" below).
2. **The decision moves real money, irreversibly, the moment it's
   made.** A wrong or manipulated verdict doesn't just produce a bad
   answer -- it produces a wrong payment that (outside the narrow,
   bounded dispute path below) cannot be undone. That is a fundamentally
   higher bar than "best-effort LLM output," and it's the reason every
   payout path in this contract follows the strict zero-then-transfer
   discipline described in SECTION 6/7/8 below.
3. **The evidence is live, external, and adversarial by construction.**
   A challenger picks the URL. A centralized backend fetching that URL
   and reporting "I checked, it's fine" is asking every user to trust
   that one operator didn't fake the fetch, didn't get socially
   engineered, and isn't simply lying -- with zero way for anyone else
   to independently verify after the fact. GenVM's `gl.nondet.web.render`
   means MULTIPLE independent validators each fetch the page themselves
   and must reach the same judgment for consensus to succeed; no single
   party's claimed fetch is ever taken on faith.

A plain (non-GenLayer) LLM API call fails on point 1 and point 3
simultaneously: whoever holds the API key IS the centralized judge, and
whoever calls the API controls exactly what "evidence" the model even
sees. This contract's answer to both is the same mechanism: the fetch
and the judgment happen inside consensus, not before it.

======================================================================
END-TO-END TRACE: USER ACTION -> ESCROWED FUNDS -> GENVM FETCH ->
                   VALIDATOR CONSENSUS -> IRREVERSIBLE STATE TRANSITION
======================================================================

    `create_bounty(...)`  [creator, payable == reward_amount]
        -> GEN moves creator wallet -> this contract. `Bounty.reward_deposited`
           records exactly what's held. Criteria are stored but NOT yet
           locked (still editable via `update_bounty_criteria`-style admin
           paths do not exist -- see below; the ONLY way criteria change
           after this point is that they become immutable on first accept).

    `accept_bounty(bounty_id)`  [challenger, payable == required_bond]
        -> GEN moves challenger wallet -> this contract. `Bounty.criteria_locked`
           flips permanently True on the FIRST call for a given bounty --
           from this instant on, NO code path in this contract can alter
           `proof_criteria`/`evidence_requirements`/`claim_text`. The
           question being judged cannot move after a challenger has
           already committed money to answering it.

    `submit_evidence(...)` -> `request_verification(...)`  [anyone; permissionless trigger]
        -> `_collect_verdict` calls `gl.nondet.web.render(evidence_url, mode="text")`
           INSIDE GenVM's non-deterministic execution -- this is the GenVM
           web fetch. The fetched text (never the challenger's own
           `evidence_description`) is placed into an LLM prompt alongside
           the FROZEN criteria from the previous step.
        -> `gl.eq_principle.prompt_comparative` runs that prompt across
           GenLayer's independent validator set -- this is the validator
           consensus. See "AVOIDING UNDETERMINED / LEADER-ROTATION
           OUTCOMES" for exactly what must match for consensus to succeed.
        -> The agreed verdict (APPROVED / PARTIAL / REJECTED /
           NEEDS_REVISION / INSUFFICIENT_EVIDENCE) is what
           `request_verification` receives back -- not a centralized
           service's opinion, not the challenger's claim.
        -> `_settle_reward_to_winner` / `_refund_attempt_bond` /
           `_forfeit_attempt_bond` execute the STATE TRANSITION: read the
           relevant ledger field, zero it, persist the new terminal
           status, and ONLY THEN call `_send_gen`. On APPROVED/PARTIAL
           this is the payout leaving the contract for the challenger's
           wallet; on REJECTED (once forfeiture is claimed) it is the
           bond moving to the creator. Once `ATTEMPT_WON` is reached,
           this is irreversible -- see the bounded-override guarantee
           immediately below.

That whole chain -- fund lock, criteria freeze, live fetch, independent
judgment, agreed verdict, irreversible transfer -- is what "GenLayer
decides a real payout" means concretely in this codebase, not as a
marketing claim but as a traceable sequence of specific method calls
any reviewer can follow and any test in `tests/integration/` can assert
against.

======================================================================
ARBITER TRUST MODEL AND THE APPEAL PATH -- BOUNDED, NOT ROUTINE, NOT SILENT
======================================================================

AI consensus is the PRIMARY path. Every attempt that is never disputed
settles entirely through the trace above -- no human ever touches it.
The dispute/arbiter machinery exists ONLY as a bounded, appealable
exception path for cases someone believes the automated check got
wrong, and it is deliberately constrained so it cannot become a routine
substitute for consensus, and so that its FINAL word is never a human's:

1. **It can never touch money AI consensus has already paid.**
   `raise_dispute` only accepts attempts still in `_ATTEMPT_LIVE_STATES`
   (ACCEPTED, SUBMITTED, NEEDS_REVISION, REJECTED_FINAL). `ATTEMPT_WON`
   is a terminal status EXCLUDED from that set -- once AI consensus has
   settled a reward, there is no method on this contract that can
   reopen, reverse, or claw it back. The only attempts a human arbiter
   can ever rule on are ones where AI consensus either never rendered a
   verdict yet, or rendered a REJECTED verdict whose bond has not yet
   been claimed (`claim_bond_forfeiture` requires this explicit, separate
   claim specifically so a wrongly-rejected challenger has a real window
   to dispute BEFORE forfeiture, not after).
2. **The arbiter's ruling never moves money immediately, and never has
   the final word.** `resolve_dispute` only records a PENDING verdict
   and opens a 2-day `appeal_deadline` window
   (`ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL`). Either party may
   `appeal_arbiter_resolution` (posting a bond) within that window to
   escalate to `resolve_appeal` -- a SECOND, independent round of
   GenLayer validator consensus (`_collect_appeal_verdict`), never a
   human owner's personal judgment. Only if NEITHER party appeals does
   `finalize_arbiter_resolution` (permissionless) execute the arbiter's
   ruling as-is once the window closes. This means the only way a human
   ruling ever determines a payout is if both parties decline their
   available right to a fresh, independent GenLayer consensus review --
   not because any human has final authority over the outcome.
3. **Every human ruling requires written, on-chain justification.**
   `resolve_dispute` rejects an empty `resolution_note` -- an arbiter
   cannot even open the pending-appeal window on a bare verdict code
   with no stated reasoning attached to the permanent record.
4. **Whether the arbiter's (still-standing, unappealed) ruling actually
   changed anything is recorded and aggregated, not asserted.** Every
   `Attempt` carries `human_verdict_overrode_ai`, computed by comparing
   the arbiter's ruling against whatever AI consensus had already
   concluded for that specific attempt (see
   `_human_verdict_matches_ai_outcome`) -- a ruling that merely confirms
   the AI's own verdict is NOT counted as an override. Every settlement,
   whichever path produced it, increments exactly one of two
   contract-wide counters (`attempts_settled_by_ai_consensus` --
   which includes BOTH the primary path and every `resolve_appeal`
   resolution, since that tier is GenLayer consensus too --
   `attempts_settled_by_human_override`, incremented only when an
   arbiter's diverging ruling stood UNAPPEALED), queryable at any time
   via `get_settlement_transparency()`. This makes the real, remaining
   trust boundary a live, on-chain, unfalsifiable fact: the only
   circumstance a human's word ever determines a payout is when it goes
   unchallenged by choice, and exactly how often that happens is
   directly queryable, not a claim anyone has to take on faith.

**What this deliberately is NOT**: a staked, multi-arbiter marketplace
with slashing and conflict-of-interest disclosure for the FIRST-pass
arbiter selection itself. That is a legitimately larger protocol
redesign (an entire second incentive-compatible subsystem, not a
contract tweak) and is documented here as a real, intentional scope
boundary rather than silently left unaddressed. What this contract does
guarantee is that the arbiter is never the LAST word: appealing always
escalates to GenLayer consensus, not to a more-trusted human. An earlier
version of this contract routed the final appeal tier through the
protocol owner directly (`resolve_appeal` was owner-gated); that was
replaced specifically because a human backstop -- however disclosed --
undercut the claim that GenLayer consensus is what ultimately produces
a fair payout. The owner retains only non-monetary admin functions
(default fee, treasury address, pause flag) and can never move a single
bounty's escrowed funds.

======================================================================
AVOIDING UNDETERMINED / LEADER-ROTATION OUTCOMES
======================================================================

`gl.eq_principle.prompt_comparative` requires every validator's
independently-run judgment to agree on the fields that matter
economically, or consensus fails outright (UNDETERMINED). Two design
choices keep that from happening on ordinary, harmless variance:

- **`reasoning` is free text and is explicitly EXEMPTED from the
  equality check** -- validators are told, in the principle text itself,
  that differing wording is expected and must not be compared. Forcing
  byte-identical prose across independently-sampled LLM calls would
  manufacture spurious disagreement on a field that carries no economic
  weight.
- **A PARTIAL verdict's `payout_bps` is rounded onto a coarse, discrete
  500-bps grid (`_bucket_payout_bps`) INSIDE the non-deterministic
  closure, before the comparison ever runs.** This is what lets the
  principle demand an EXACT match on the number that actually determines
  the payout, instead of a fuzzy tolerance window that would let two
  validators' "close enough" estimates diverge from what's literally
  paid out. Bucketing closes the gap between "what consensus agreed to"
  and "what money actually moves" -- they are, by construction, the same
  number.
- **`content_hash` (the evidence-manifest fingerprint, see below) is also
  exempted** -- it is a per-validator fingerprint of a live, mutable web
  page each validator independently fetched, not expected to be
  byte-identical across fetches, and recorded for provenance only.

A malformed or unparseable LLM response degrades deterministically to
`NEEDS_REVISION` (`_collect_verdict`'s outer parse) rather than crashing
the transaction or producing an inconsistent per-validator result --
every validator that fails to parse the SAME malformed response reaches
the SAME fallback, so consensus still converges instead of UNDETERMINING
on a formatting accident.

======================================================================
SETTLEMENT AVAILABILITY -- WHY ATTEMPTS ARE CAPPED
======================================================================

`_mark_other_attempts_lost_race` runs once, every time a bounty settles,
over every attempt that bounty has EVER accumulated. Without a bound,
an attacker could open enough low/zero-bond attempts on a bounty
(`accept_bounty` has no per-challenger uniqueness rule by design -- the
marketplace explicitly allows concurrent racing attempts) to make that
loop, and therefore the LEGITIMATE WINNER's own settlement transaction,
too expensive to execute -- a denial-of-service on the exact transaction
meant to pay someone. `MAX_ATTEMPTS_PER_BOUNTY = 40` bounds that cost
to a fixed, predictable ceiling regardless of how popular a bounty
becomes, while remaining generous for any real marketplace bounty (each
attempt still costs the attacker real bond/gas to open).

======================================================================
EVIDENCE MANIFEST -- WHAT "PROOF" ACTUALLY MEANS HERE
======================================================================

Every successful `request_verification` stamps `evidence_content_hash`
(`_content_digest` -- a fast, deterministic 64-bit FNV-1a fingerprint,
deliberately NOT cryptographically strong, see that function's
docstring for why hashlib is avoided) onto the attempt: a record of
EXACTLY what text every validator fetched and judged, independent of
this contract's own storage of the raw `evidence_url`.

**What this proves**: that a later reader holding an independently-
archived copy of the evidence page can check whether their copy's
fingerprint matches what was actually judged on-chain -- a concrete,
checkable claim about provenance.

**What this does NOT prove, and this contract never claims it does**:
that the fingerprint reconstructs the page, that it survives the source
page changing or disappearing, or that any two validators fetched
byte-identical content (a live, mutable web page is not a fixed
artifact -- see "AVOIDING UNDETERMINED" above for why the hash is
explicitly exempted from consensus comparison). This contract has no
archival storage of its own and does not pin evidence to IPFS/Arweon or
any other content-addressed store. The project's backend indexer
independently re-fetches evidence and computes a real SHA-256 archive as
a SEPARATE, best-effort provenance layer (see `apps/api/src/services/evidence-archiver.ts`
and `docs/SECURITY.md`) -- explicitly NOT a proof that the archived copy
is what any specific validator saw, only an independently-fetched,
independently-hashed reference point with its own recorded match/mismatch
status against this on-chain fingerprint.
"""

import datetime
import json
import typing
from dataclasses import dataclass

from genlayer import *


# ============================================================================
# SECTION 1: STATUS CONSTANTS
# ============================================================================
# GenVM storage does not support Python's `enum.Enum` for persisted fields,
# so every status lives as a plain module-level integer constant stored in a
# `u8` field. Named constants (never magic numbers) are what keep a
# 1000+ line state machine reviewable years from now.

# --- Bounty.status ---
BOUNTY_OPEN: int = 0
"""Created and funded. Zero or more concurrent attempts may exist."""

BOUNTY_SETTLED: int = 1
"""Terminal: reward has been paid out to a winning attempt."""

BOUNTY_CANCELLED: int = 2
"""Terminal: creator cancelled before any attempt was ever accepted."""

BOUNTY_EXPIRED_REFUNDED: int = 3
"""Terminal: deadline passed with no winning attempt; reward reclaimed."""

BOUNTY_STATUS_LABELS: typing.Final[dict[int, str]] = {
    BOUNTY_OPEN: "OPEN",
    BOUNTY_SETTLED: "SETTLED",
    BOUNTY_CANCELLED: "CANCELLED",
    BOUNTY_EXPIRED_REFUNDED: "EXPIRED_REFUNDED",
}

# --- Attempt.status ---
ATTEMPT_ACCEPTED: int = 0
"""Bond locked; challenger is researching, no evidence submitted yet."""

ATTEMPT_SUBMITTED: int = 1
"""Evidence URL submitted; awaiting `request_verification`."""

ATTEMPT_NEEDS_REVISION: int = 2
"""Verdict asked for a fixable resubmission (e.g. URL was unreachable)."""

ATTEMPT_WON: int = 3
"""Terminal: this attempt's evidence won the bounty (APPROVED or PARTIAL);
reward has been paid out and the bond has been returned."""

ATTEMPT_LOST_RACE: int = 4
"""Terminal: another attempt on the same bounty won first; this attempt's
bond has been returned in full since it never had a fair chance to be
judged against a still-open bounty."""

ATTEMPT_REJECTED_FINAL: int = 5
"""Terminal-pending-forfeiture: revision cap exhausted or a clear REJECTED
verdict was reached with the bounty still open; bond is forfeitable to the
creator via `claim_bond_forfeiture` unless a dispute is raised first."""

ATTEMPT_BOND_FORFEITED: int = 6
"""Terminal: bond has been forfeited to the bounty creator."""

ATTEMPT_DISPUTED: int = 7
"""Either party contested the verdict; frozen pending arbiter action."""

ATTEMPT_CANCELLED: int = 8
"""Terminal: bond returned without a verdict (e.g. bounty cancelled)."""

ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL: int = 9
"""The arbiter has ruled on a disputed attempt, but the ruling is NOT yet
executed -- money has NOT moved. Either party may `appeal_arbiter_resolution`
before `appeal_deadline`; if nobody does, anyone may permissionlessly call
`finalize_arbiter_resolution` after `appeal_deadline` to actually execute
the stored verdict. This two-step design exists specifically so a genuine
appeal is possible: once `_settle_reward_to_winner`/`_forfeit_attempt_bond`
has already moved GEN, there is nothing left to appeal *to* -- an on-chain
escrow cannot claw back a completed transfer trustlessly. Holding the
payout behind a window is what makes "arbiter override with an appeal
path" structurally real rather than cosmetic."""

ATTEMPT_APPEALED: int = 10
"""An appeal bond has been posted contesting the arbiter's pending
resolution; frozen for the protocol owner to make the final call via
`resolve_appeal`. This is the contract's second and final resolution
tier -- see the module docstring's "ARBITER TRUST MODEL" section for why
the owner (already the sole trusted party for admin functions) is the
right final tier rather than inventing a new, unstaked authority."""

ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL: int = 11
"""Terminal: the fetched evidence was real, readable, and on-topic, but
consensus could not confidently say it satisfies OR fails the
precommitted criteria after every resubmission cycle was exhausted (see
`VERDICT_INSUFFICIENT_EVIDENCE`). Distinct from `ATTEMPT_REJECTED_FINAL`
in consequence as well as meaning: the bond is auto-refunded here (see
`request_verification`), never forfeitable, because "no available
evidence could confidently settle this" is not the challenger's fault the
way a demonstrably-wrong submission is."""

ATTEMPT_STATUS_LABELS: typing.Final[dict[int, str]] = {
    ATTEMPT_ACCEPTED: "ACCEPTED",
    ATTEMPT_SUBMITTED: "SUBMITTED",
    ATTEMPT_NEEDS_REVISION: "NEEDS_REVISION",
    ATTEMPT_WON: "WON",
    ATTEMPT_LOST_RACE: "LOST_RACE",
    ATTEMPT_REJECTED_FINAL: "REJECTED_FINAL",
    ATTEMPT_BOND_FORFEITED: "BOND_FORFEITED",
    ATTEMPT_DISPUTED: "DISPUTED",
    ATTEMPT_CANCELLED: "CANCELLED",
    ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL: "ARBITER_RESOLVED_PENDING_APPEAL",
    ATTEMPT_APPEALED: "APPEALED",
    ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL: "INSUFFICIENT_EVIDENCE_FINAL",
}

# Attempt states an ordinary (non-arbiter) timeout/settlement path may act
# on. Kept as an explicit whitelist -- rather than "everything not
# terminal" -- so a newly-added status can never silently become
# timeout-actionable without a deliberate review of this tuple.
_ATTEMPT_LIVE_STATES: typing.Final[tuple[int, ...]] = (
    ATTEMPT_ACCEPTED,
    ATTEMPT_SUBMITTED,
    ATTEMPT_NEEDS_REVISION,
    ATTEMPT_REJECTED_FINAL,
)

_ATTEMPT_TERMINAL_STATES: typing.Final[tuple[int, ...]] = (
    ATTEMPT_WON,
    ATTEMPT_LOST_RACE,
    ATTEMPT_BOND_FORFEITED,
    ATTEMPT_CANCELLED,
    ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL,
)

# --- Verdicts returned by the AI consensus check ---
VERDICT_APPROVED: str = "APPROVED"
VERDICT_PARTIAL: str = "PARTIAL"
"""The fetched evidence substantially, but incompletely, satisfies the
precommitted criteria -- e.g. 3 of 4 criteria are concretely met. Rather
than forcing a binary approve/reject, the verifier may recommend a split
payout via `payout_bps` (see `_collect_verdict`), matching PROOFBOUNTY's
"partial proofs" product requirement (canonical 5-point percentage
buckets)."""
VERDICT_NEEDS_REVISION: str = "NEEDS_REVISION"
VERDICT_REJECTED: str = "REJECTED"
VERDICT_INSUFFICIENT_EVIDENCE: str = "INSUFFICIENT_EVIDENCE"
"""The fetched content is real, readable, and on-topic -- not a fetch
failure, not the wrong page -- but does not itself confirm OR contradict
the precommitted criteria (e.g. the claim requires a number the page
simply doesn't state). Distinct from `NEEDS_REVISION` (a fixable
technical/submission problem, like a dead link) and `REJECTED` (the
content unambiguously fails the criteria): here the content is exactly
what it claims to be, it just isn't dispositive. Exhausting the
resubmission cycle on this verdict refunds the bond rather than
forfeiting it -- see `ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL`."""
_VALID_VERDICTS: typing.Final[tuple[str, ...]] = (
    VERDICT_APPROVED,
    VERDICT_PARTIAL,
    VERDICT_NEEDS_REVISION,
    VERDICT_REJECTED,
    VERDICT_INSUFFICIENT_EVIDENCE,
)

# --- Arbiter override verdicts (dispute resolution) ---
ARBITER_APPROVE: str = "APPROVE"
ARBITER_REJECT: str = "REJECT"
ARBITER_PARTIAL: str = "PARTIAL"
_VALID_ARBITER_VERDICTS: typing.Final[tuple[str, ...]] = (
    ARBITER_APPROVE,
    ARBITER_REJECT,
    ARBITER_PARTIAL,
)


# ============================================================================
# SECTION 2: PROTOCOL-WIDE CONSTANTS
# ============================================================================

MAX_FEE_BPS: int = 1000
"""Hard ceiling on the platform fee: 1000 basis points = 10%. Applied only
to the winning share of a reward, never to a returned bond and never to a
refund -- see `_fee_and_net`."""

BPS_DENOMINATOR: int = 10_000
"""Basis-point denominator used for fee and partial-payout math."""

PAYOUT_BUCKET_BPS: int = 500
"""Bucket width (5 percentage points) that a PARTIAL verdict's `payout_bps`
is rounded onto BEFORE it is ever compared across validators or used to
compute an actual payout -- see `_bucket_payout_bps`. This is the
mechanism (see module docstring, "AVOIDING UNDETERMINED / LEADER-ROTATION
OUTCOMES") that lets the equivalence principle demand an EXACT match on
the paid split instead of a fuzzy tolerance window: independent LLM
estimates that are close collapse onto the same discrete bucket, so "close
enough" and "identical" become the same thing by construction, and the
number that is compared for consensus is exactly the number that is paid
out -- never a looser proxy for it."""

DEFAULT_MAX_REVISIONS: int = 3
"""How many NEEDS_REVISION cycles an attempt gets before it is marked
REJECTED_FINAL and its bond becomes forfeitable, absent a dispute."""

MIN_BOUNTY_DEADLINE_SECONDS: int = 3600
"""A bounty's deadline must be at least one hour out from creation, so a
creator cannot post a bounty that is immediately unattemptable/expired."""

ARBITER_GRACE_SECONDS: int = 3 * 24 * 3600
"""Extra grace period past a bounty's deadline before either party may
force a default resolution on an attempt stuck in DISPUTED with no arbiter
action. Guarantees a disputed attempt's bond can never be permanently
locked just because a named arbiter goes silent."""

MAX_LISTING_SCAN: int = 200
"""Upper bound on how many ids a single view-call will scan, so a view
method can never be made to loop unboundedly as the protocol grows.
Pagination is via `start_id` / `limit` parameters."""

MAX_ATTEMPTS_PER_BOUNTY: int = 40
"""Hard cap on concurrent attempts a single bounty can ever accumulate,
enforced in `accept_bounty`. This is a settlement-availability guarantee,
not a cosmetic limit: `_mark_other_attempts_lost_race` (called every time
a bounty settles) loops once over every existing attempt on that bounty to
flip still-live ones to LOST_RACE. Without a cap, an attacker could open
enough zero/low-bond attempts on a bounty to make that loop -- and
therefore the winning challenger's own settlement transaction -- exceed
practical execution limits, denying the legitimate winner their payout.
40 is generous for any real marketplace bounty (each attempt still costs
the attacker gas/fees to open) while keeping the settlement loop's cost
bounded and predictable regardless of how popular a bounty becomes."""

VERIFICATION_GRACE_SECONDS: int = 24 * 3600
"""Extra buffer after `Bounty.deadline` before `claim_creator_timeout`
may reclaim an unsettled reward. Exists because `deadline` bounds when a
challenger may last SUBMIT evidence (see `submit_evidence`'s own deadline
check), not when verification must complete -- without this buffer, a
creator could race a legitimately-submitted, still-pending SUBMITTED
attempt to reclaim the reward the instant the deadline ticks over, even
though that attempt was submitted in time and simply hasn't been verified
yet. This grace window gives any evidence submitted right up to the wire
a real chance to be verified before the reward becomes reclaimable."""

APPEAL_WINDOW_SECONDS: int = 2 * 24 * 3600
"""How long either party has, after an arbiter resolves a dispute, to
`appeal_arbiter_resolution` before the ruling becomes final and
permissionlessly executable via `finalize_arbiter_resolution`. See
ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL's docstring for why payout is
held behind this window rather than executed immediately."""

MAX_CRITERIA_LEN: int = 4000
MAX_EVIDENCE_REQUIREMENTS_LEN: int = 2000
MAX_TITLE_LEN: int = 200
MAX_URL_LEN: int = 2000
MAX_REASONING_LEN: int = 600
"""Bounded lengths for every user-supplied and model-generated string field
that gets persisted to storage or fed into a prompt, so no single call can
inflate storage cost or blow out an LLM's context window unboundedly."""

WEB_FETCH_CHAR_LIMIT: int = 12_000
"""Fetched evidence page content is truncated to this many characters
before being placed in the evaluation prompt, keeping prompt size bounded
regardless of how large the live page actually is."""

VALID_CATEGORIES: typing.Final[tuple[str, ...]] = (
    "SECURITY",
    "GOVERNANCE",
    "OPEN_SOURCE",
    "DOCUMENTATION",
    "PROTOCOL_RESEARCH",
    "ONCHAIN_ANALYSIS",
    "PRODUCT_CLAIMS",
    "PUBLIC_ACCOUNTABILITY",
    "OTHER",
)
"""Fixed category enum, matching the marketplace filter taxonomy. Kept
closed (not a free-text field) so search/filter/reputation-by-specialization
all stay meaningful across the whole protocol instead of fragmenting into
inconsistent free-text categories."""

CLAIM_POSITIVE: str = "POSITIVE"
CLAIM_NEGATIVE: str = "NEGATIVE"
_VALID_CLAIM_POLARITY: typing.Final[tuple[str, ...]] = (CLAIM_POSITIVE, CLAIM_NEGATIVE)
"""PROOFBOUNTY explicitly supports both "prove this succeeded" (POSITIVE)
and "prove this failed/violated its own rules" (NEGATIVE) claims -- see
PROOFBOUNTY.md section 17. Purely informational/filterable; does not change
contract logic, since both are judged identically against precommitted
criteria."""


def _bucket_payout_bps(bps: int) -> int:
    """
    Round a PARTIAL-verdict payout percentage onto the coarse, discrete grid
    defined by `PAYOUT_BUCKET_BPS`, clamped away from the degenerate 0%/100%
    endpoints (a "partial" payout that is actually 0% or 100% is not
    partial -- see the callers, which reclassify those as REJECTED/APPROVED
    instead of letting a degenerate split through).

    Pure and deterministic: every validator calling it on their own
    independently-estimated `payout_bps` gets the identical bucketed output
    whenever their raw estimates are close. That is precisely what lets
    `_collect_verdict`'s equivalence principle require an EXACT match on
    the bucketed value instead of a tolerance window on the raw one --
    closing the gap between "the value that reaches consensus" and "the
    value that actually gets paid out" (see module docstring).
    """
    bps = max(0, min(int(bps), BPS_DENOMINATOR))
    bucketed = int(round(bps / PAYOUT_BUCKET_BPS)) * PAYOUT_BUCKET_BPS
    bucketed = max(PAYOUT_BUCKET_BPS, min(bucketed, BPS_DENOMINATOR - PAYOUT_BUCKET_BPS))
    return bucketed


def _human_verdict_matches_ai_outcome(
    last_ai_verdict: str, last_ai_payout_bps: int, human_verdict: str, human_bucketed_bps: int
) -> bool:
    """
    True only if a human ruling (`resolve_dispute`/`resolve_appeal`)
    reaches the SAME economic outcome the AI consensus path had already
    reached for this attempt -- used to compute `Attempt.human_verdict_overrode_ai`
    (see that field's docstring and `get_settlement_transparency`).

    If the attempt was never AI-verified at all (`last_ai_verdict == ""` --
    e.g. disputed while still ACCEPTED, before `request_verification` was
    ever called), this always returns False: there is no AI economic
    conclusion to match, so a human ruling here is definitionally deciding
    the outcome itself rather than confirming or overriding one.
    """
    if not last_ai_verdict:
        return False
    if human_verdict == ARBITER_APPROVE:
        return last_ai_verdict == VERDICT_APPROVED
    if human_verdict == ARBITER_REJECT:
        return last_ai_verdict == VERDICT_REJECTED
    if human_verdict == ARBITER_PARTIAL:
        return last_ai_verdict == VERDICT_PARTIAL and int(last_ai_payout_bps) == human_bucketed_bps
    return False


def _truncate(value: str, limit: int) -> str:
    if value is None:
        return ""
    return value if len(value) <= limit else value[:limit]


def _content_digest(content: str) -> str:
    """
    Deterministic content fingerprint for the EVIDENCE MANIFEST (see
    `_collect_verdict` / `Attempt.evidence_content_hash`), computed with
    pure Python arithmetic only -- no `hashlib` or other stdlib import.
    This is a deliberate choice: this file was previously bitten by
    invoking a `gl.*` API that looked standard but did not exist on the
    pinned GenVM runner (see `get_contract_balance`'s docstring), so
    rather than assume `hashlib` is available inside GenVM's constrained
    Python sandbox, this hash is built from nothing but integer/string
    operations guaranteed to work anywhere Python itself runs. It is a
    64-bit FNV-1a variant: not cryptographically collision-resistant
    against a deliberate adversary, but it does not need to be -- its job
    is to let anyone who saved the fetched page independently prove
    whether their copy matches what every validator actually judged
    on-chain, and to detect *accidental* content drift (the source page
    changed) between when it was judged and any later reference. Fully
    deterministic: every validator computing this over the same fetched
    bytes gets the identical digest, which is required for it to safely
    flow through `gl.eq_principle.prompt_comparative` consensus at all.
    """
    h = 0xCBF29CE484222325  # FNV offset basis (64-bit)
    prime = 0x100000001B3  # FNV prime (64-bit)
    mask = (1 << 64) - 1
    for ch in content:
        h = (h ^ ord(ch)) & mask
        h = (h * prime) & mask
    return format(h, "016x")


# ============================================================================
# SECTION 3: STORAGE-COMPATIBLE DATA STRUCTURES
# ============================================================================
# Every struct persisted in a `TreeMap` value is a `@dataclass` decorated
# with `@allow_storage` -- GenVM's explicit marker that the class was
# reviewed for storage use. Undecorated classes and bare dict/list fields
# are exactly the pattern that has previously caused "could not load
# contract schema" failures against real GenVM runners; this file never
# uses either.


@allow_storage
@dataclass
class Attempt:
    """
    One challenger's race to produce winning evidence against a Bounty.

    Money accounting: `bond_amount` is the agreed term (copied from the
    bounty's `required_bond` at acceptance time so a later bond-requirement
    change on the bounty template -- which cannot happen post-lock anyway,
    see `_require_criteria_locked` -- could never retroactively affect an
    in-flight attempt); `bond_deposited` is the live escrow ledger, zeroed
    by every terminal path before any transfer (module docstring).
    """

    attempt_key: u256
    """Global id: `bounty_id * 100_000 + index_within_bounty`."""

    bounty_id: u256
    index: u256

    challenger: Address

    bond_amount: u256
    bond_deposited: u256

    status: u8

    evidence_url: str
    evidence_description: str
    """Challenger's own account of what the evidence shows -- persisted for
    human readers, but NEVER passed to the verifier as the thing being
    judged; the verifier only ever judges the independently-fetched page
    content itself (module docstring, "GENLAYER AS REFEREE")."""

    revision_count: u8
    max_revisions: u8

    last_verdict: str
    last_reasoning: str
    last_payout_bps: u256
    """Bucketed payout_bps from the most recent PARTIAL verdict, if any;
    0 for any other verdict. Persisted for auditability."""

    evidence_content_hash: str
    """EVIDENCE MANIFEST (audit-driven addition): the deterministic
    `_content_digest` of the exact page text every validator fetched and
    judged at verification time -- see `_collect_verdict`. Empty until the
    first `request_verification` call succeeds. This is what lets a later
    reader independently confirm "this is the exact content the verdict
    was based on," even though the underlying URL is a live, mutable web
    page and the contract does not archive the page body itself (that
    would require off-chain storage this contract does not have; the hash
    is the on-chain-verifiable half of provenance -- pair it with an
    off-chain archive, e.g. a Wayback Machine / IPFS snapshot taken at
    `evidence_fetched_at`, for full reconstruction)."""

    evidence_fetched_at: u256
    """Unix timestamp of the transaction that produced `evidence_content_hash`
    -- i.e. exactly when the judged fetch happened, distinct from
    `submitted_at` (when the URL was merely submitted, possibly well
    before it was ever fetched)."""

    disputed_by: Address
    dispute_reason: str

    pending_arbiter_verdict: str
    """Set by `resolve_dispute` when the arbiter rules; NOT yet executed.
    Cleared once `finalize_arbiter_resolution` or `resolve_appeal` actually
    settles funds. See ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL."""

    pending_payout_bps: u256
    appeal_deadline: u256
    appealed_by: Address
    appeal_reason: str
    appeal_bond_deposited: u256
    """Escrowed separately from `bond_deposited` -- an appellant must post
    this bond, forfeited to the non-appealing party if the owner's final
    ruling agrees with the arbiter (deterring frivolous appeals), returned
    to the appellant if the owner's ruling overturns the arbiter instead."""

    created_at: u256
    submitted_at: u256
    resolved_at: u256
    resolved_by_arbiter: bool
    human_verdict_overrode_ai: bool
    """Set only when a human ruling (`resolve_dispute` or `resolve_appeal`)
    actually changed the economic outcome versus what `request_verification`
    had already determined for this attempt (a different verdict category,
    or the same category with a different bucketed payout). Left `False`
    when a human simply upholds the AI's own conclusion after review, or
    when the attempt was never AI-verified at all before being disputed
    (nothing to compare against). This is what lets `get_settlement_transparency`
    report a genuine override rate rather than an activity count -- a
    dispute that gets raised and then resolved IN AGREEMENT with the AI is
    not the same event as a human actually substituting their own verdict,
    and conflating the two would make the arbiter/appeal tier look more
    consequential than it actually is in practice."""


@allow_storage
@dataclass
class Bounty:
    """A financially-backed public claim with precommitted proof criteria."""

    bounty_id: u256

    creator: Address
    arbiter: Address
    """Trusted third party who may resolve disputes raised on this bounty's
    attempts. May equal the creator (self-arbitrated), never the zero
    address (see `create_bounty`)."""

    title: str
    claim_text: str
    """The full claim under test -- what the creator believes can be
    publicly demonstrated (or disproven, for NEGATIVE claims)."""

    claim_polarity: str
    """POSITIVE or NEGATIVE -- see `_VALID_CLAIM_POLARITY`."""

    category: str

    proof_criteria: str
    """Precommitted, machine-checkable acceptance criteria, stored as the
    creator's own numbered/structured text. Immutable once any attempt has
    been accepted -- see `_require_criteria_locked`. This exact string is
    what every validator's evaluation prompt judges the fetched evidence
    against (module docstring, "GENLAYER AS REFEREE")."""

    evidence_requirements: str
    """What kind of evidence is acceptable (URL type, repo, tx hash,
    document, etc.) -- guidance for challengers, also immutable post-lock."""

    status: u8

    reward_amount: u256
    """Agreed reward term, in native GEN units."""
    reward_deposited: u256
    """Live reward escrow ledger. Authoritative for all payout math."""

    required_bond: u256
    """Bond every challenger must lock exactly, via `accept_bounty`. Zero
    means no bond is required."""

    platform_fee_bps: u256
    """Fee rate captured at creation time; later owner fee changes never
    retroactively affect an in-flight bounty."""

    attempt_count: u256
    attempts_won: u256
    """0 or 1 -- a bounty can only ever have exactly one winning attempt;
    kept as a counter (not a bool) purely so `get_bounty` summaries read
    uniformly alongside the other counters."""

    winning_attempt_index: u256
    """Index of the winning attempt once `attempts_won == 1`; meaningless
    (0) until then -- always check `attempts_won` first."""

    criteria_locked: bool
    """True the moment the first attempt is accepted. See
    `_require_criteria_locked` -- this is what makes proof criteria and
    evidence requirements immutable exactly when PROOFBOUNTY.md requires
    (section 10: "Avoid allowing bounty creators to modify criteria after a
    challenger has submitted evidence... Prevent evaluation criteria from
    being manipulated after commitment"). Locking at acceptance rather than
    at first evidence submission is deliberately stricter: it protects a
    challenger's decision to accept and lock a bond in the first place, not
    just their evidence once written."""

    deadline: u256
    """Unix timestamp. After this point, `claim_creator_timeout` may
    reclaim an unsettled reward, and (subject to `ARBITER_GRACE_SECONDS`
    for disputed attempts) attempt-level timeout paths become available."""

    created_at: u256


@allow_storage
@dataclass
class Reputation:
    """On-chain track record for an address across every bounty it has
    touched as either a creator or a challenger, derived exclusively from
    settled protocol events -- never self-reported (PROOFBOUNTY.md section
    41: "Do not make reputation purely self-reported... derive from actual
    protocol events and settled outcomes")."""

    bounties_created: u256
    bounties_funded_total: u256
    """Gross GEN this address has ever locked into escrow as a creator,
    across every bounty (successful, cancelled, or expired)."""

    attempts_made: u256
    attempts_won: u256
    attempts_partial: u256
    attempts_rejected: u256
    attempts_disputed: u256

    total_earned: u256
    """Net GEN received across every winning/partial attempt, as a
    challenger."""


# ============================================================================
# SECTION 4: NATIVE VALUE TRANSFER
# ============================================================================
# GenVM contracts have no built-in "send native token" statement. On this
# pinned runner there are two similarly-named but NOT interchangeable
# mechanisms for moving value out of the contract:
#
#   * `gl.get_contract_at(address).emit_transfer(...)` -- GenVM's native
#     intelligent-contract-to-intelligent-contract message path. Does NOT
#     settle a real balance for a plain externally-owned wallet (MetaMask-
#     style EOA); calling it against an ordinary wallet fails with
#     "Contract <address> not found".
#   * `@gl.evm.contract_interface` + a stub's `.emit_transfer(value=...)`
#     routes through the EVM-compatibility bridge instead, which IS the
#     mechanism that delivers value to a plain wallet address -- the
#     documented pattern in GenLayer's own `faucet.py` reference example.
#
# Every payout in PROOFBOUNTY goes to a bounty's creator/challenger/treasury
# -- ordinary connected wallets, not other deployed contracts -- so the EVM
# bridge path is the correct and only one used here. All of it funnels
# through the single `_send_gen` helper below.


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


# ============================================================================
# SECTION 5: THE CONTRACT
# ============================================================================


class ProofBounty(gl.Contract):
    """
    PROOFBOUNTY protocol: financially-backed claims settled by GenLayer's
    validator consensus against live, independently-fetched web evidence.

    See the module docstring for full design rationale. This class
    docstring covers only the call sequence a caller needs.

    Typical call sequence, one bounty, one winning attempt:

        1. `create_bounty(...)`                    -- creator, payable == reward_amount
        2. `accept_bounty(bounty_id)`               -- challenger, payable == required_bond
        3. `submit_evidence(bounty_id, idx, url, description)`  -- challenger
        4. `request_verification(bounty_id, idx)`   -- anyone (permissionless trigger)
               -> APPROVED / PARTIAL: reward settled to this attempt automatically;
                                       every other still-open attempt becomes
                                       reclaimable via `reclaim_bond_after_settlement`
               -> NEEDS_REVISION:      back to step 3 (until `max_revisions` reached)
               -> REJECTED (final):    `claim_bond_forfeiture` (creator) or a
                                       dispute may still be raised first
        5. Either party may `raise_dispute(...)` on a not-yet-terminal attempt at
           any time, which freezes it for the named `arbiter` to resolve via
           `resolve_dispute` (records a verdict, does NOT pay out yet -- see
           "ARBITER TRUST MODEL AND THE APPEAL PATH" above), or defaults safely
           via `force_default_resolution` after `deadline + ARBITER_GRACE_SECONDS`
           if the arbiter never rules at all.
        6. Once the arbiter rules, either party may `appeal_arbiter_resolution`
           (posting an appeal bond) before `appeal_deadline`, escalating to the
           owner's final call via `resolve_appeal`. If nobody appeals, anyone
           may permissionlessly `finalize_arbiter_resolution` after the window
           closes to actually execute the verdict.
    """

    # ------------------------------------------------------------------
    # Persistent storage.
    # ------------------------------------------------------------------

    owner: Address
    """Protocol admin. Tunes the default fee, treasury address, and the
    global pause flag -- and can never move escrowed funds, resolve a
    dispute, or otherwise touch a single bounty's money. That authority
    belongs exclusively to each bounty's own creator/challenger/arbiter,
    or, on appeal, to a SECOND, independent round of GenLayer validator
    consensus (`resolve_appeal`, permissionless, decided by
    `_collect_appeal_verdict` -- see "ARBITER TRUST MODEL" below and
    `get_settlement_transparency`) -- never by this owner field. An
    earlier version of this contract routed the final appeal tier through
    the owner directly; that was replaced specifically so no human ever
    makes the final, binding call on a disputed payout."""

    treasury: Address
    default_fee_bps: u256
    paused: bool
    """When true, `create_bounty` is disabled. Never affects an in-flight
    bounty: existing bounties can still be attempted, evaluated, disputed,
    and settled. A narrow circuit breaker, not an emergency-withdraw switch."""

    bounty_counter: u256
    bounties: TreeMap[u256, Bounty]
    attempts: TreeMap[u256, Attempt]
    """Keyed by the composite `attempt_key` (`bounty_id * 100_000 + index`)."""

    reputation: TreeMap[Address, Reputation]

    attempts_settled_by_ai_consensus: u256
    """Incremented exactly once per attempt, the moment `request_verification`
    (or `finalize_arbiter_resolution` degrading a race-loser to LOST_RACE
    without human involvement) produces the FIRST recorded economic outcome
    for that attempt -- i.e. every time GenLayer's validator consensus is
    what actually decided the money, with no human ruling involved at any
    point in that attempt's history. Exists so the human-override tier's
    real usage rate is a queryable on-chain fact (`get_settlement_transparency`)
    instead of a claim anyone has to take on faith."""

    attempts_settled_by_human_override: u256
    """Incremented exactly once per attempt, the moment a human ruling
    (`resolve_dispute` finalized via `finalize_arbiter_resolution`, or
    `resolve_appeal`) determines the FINAL economic outcome for an attempt
    where `human_verdict_overrode_ai` ends up `True` -- i.e. a human
    genuinely changed the outcome AI consensus had already reached, not
    merely rubber-stamped it after a dispute. Attempts that were disputed
    but where the human ruling agreed with the AI's own conclusion are
    counted in `attempts_settled_by_ai_consensus` instead, since the AI's
    verdict is what actually determined the outcome in that case."""

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def __init__(self, treasury_address: str, default_fee_bps: int) -> None:
        """
        Deploy the protocol.

        Args:
            treasury_address: hex address receiving the platform fee cut of
                every settled reward (paid only from the winning share).
            default_fee_bps: fee rate in basis points applied to new
                bounties at creation time. Must be <= MAX_FEE_BPS (1000,
                i.e. 10%).
        """
        if default_fee_bps < 0 or default_fee_bps > MAX_FEE_BPS:
            raise gl.vm.UserError(
                f"default_fee_bps must be between 0 and {MAX_FEE_BPS}"
            )

        self.owner = gl.message.sender_address
        self.treasury = Address(treasury_address)
        self.default_fee_bps = u256(default_fee_bps)
        self.paused = False
        self.bounty_counter = u256(0)
        self.attempts_settled_by_ai_consensus = u256(0)
        self.attempts_settled_by_human_override = u256(0)

    # ==================================================================
    # SECTION 6: INTERNAL HELPERS
    # ==================================================================

    def _now(self) -> int:
        """Deterministic current time as unix seconds, read from the
        transaction's own recorded timestamp (consensus-safe: every
        validator re-executing this transaction reads the identical
        value, unlike a wall-clock read)."""
        return int(datetime.datetime.fromisoformat(gl.message_raw["datetime"]).timestamp())

    def _zero_address(self) -> Address:
        return Address("0x0000000000000000000000000000000000000000")

    def _send_gen(self, to_address: Address, amount: u256) -> None:
        """The single choke point through which native value ever leaves
        this contract. See SECTION 4 for why the EVM-bridge path is the
        correct mechanism for paying plain wallet addresses."""
        if amount <= u256(0):
            raise gl.vm.UserError("Transfer amount must be positive")
        _Recipient(to_address).emit_transfer(value=amount)

    def _record_settlement_provenance(self, attempt: "Attempt", via_human_ruling: bool) -> None:
        """
        Increments exactly one of the two contract-wide settlement counters
        (see their docstrings and `get_settlement_transparency`), called at
        every point an attempt's economic outcome actually becomes final --
        AI-driven (`request_verification`'s terminal branches) or
        human-ruling-driven (`finalize_arbiter_resolution`/`resolve_appeal`'s
        money-moving branches). `force_default_resolution`'s safe-default
        refund path deliberately does NOT call this: nobody actively
        decided that outcome, so counting it as either "AI consensus" or
        "human override" would misrepresent what happened.
        """
        if via_human_ruling and attempt.human_verdict_overrode_ai:
            self.attempts_settled_by_human_override = self.attempts_settled_by_human_override + u256(1)
        else:
            self.attempts_settled_by_ai_consensus = self.attempts_settled_by_ai_consensus + u256(1)

    def _require_not_paused(self) -> None:
        if self.paused:
            raise gl.vm.UserError("Protocol is paused for new bounty creation")

    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("Caller is not the protocol owner")

    def _get_bounty(self, bounty_id: int) -> Bounty:
        key = u256(bounty_id)
        if key not in self.bounties:
            raise gl.vm.UserError(f"No bounty with id {bounty_id}")
        return self.bounties[key]

    def _attempt_key(self, bounty_id: int, index: int) -> u256:
        if index < 0 or index >= 100_000:
            raise gl.vm.UserError("Attempt index out of supported range")
        return u256(int(bounty_id) * 100_000 + int(index))

    def _get_attempt(self, bounty_id: int, index: int) -> Attempt:
        key = self._attempt_key(bounty_id, index)
        if key not in self.attempts:
            raise gl.vm.UserError(f"No attempt at index {index} for bounty {bounty_id}")
        return self.attempts[key]

    def _require_creator(self, bounty: Bounty) -> None:
        if gl.message.sender_address != bounty.creator:
            raise gl.vm.UserError("Caller is not this bounty's creator")

    def _require_challenger(self, attempt: Attempt) -> None:
        if gl.message.sender_address != attempt.challenger:
            raise gl.vm.UserError("Caller is not this attempt's challenger")

    def _require_creator_or_challenger(self, bounty: Bounty, attempt: Attempt) -> None:
        sender = gl.message.sender_address
        if sender != bounty.creator and sender != attempt.challenger:
            raise gl.vm.UserError(
                "Caller is neither this bounty's creator nor this attempt's challenger"
            )

    def _require_arbiter(self, bounty: Bounty) -> None:
        if gl.message.sender_address != bounty.arbiter:
            raise gl.vm.UserError("Caller is not this bounty's designated arbiter")

    def _require_criteria_locked_state(self, bounty: Bounty, expected: bool) -> None:
        if bounty.criteria_locked != expected:
            if expected:
                raise gl.vm.UserError("Bounty criteria are not yet locked")
            raise gl.vm.UserError(
                "Bounty criteria are already locked (an attempt has been accepted) "
                "and can no longer be edited"
            )

    def _get_or_create_reputation(self, address: Address) -> Reputation:
        if address not in self.reputation:
            self.reputation[address] = Reputation(
                bounties_created=u256(0),
                bounties_funded_total=u256(0),
                attempts_made=u256(0),
                attempts_won=u256(0),
                attempts_partial=u256(0),
                attempts_rejected=u256(0),
                attempts_disputed=u256(0),
                total_earned=u256(0),
            )
        return self.reputation[address]

    def _fee_and_net(self, gross: int, fee_bps: int) -> tuple[int, int]:
        """Split a gross payout into (fee, net_to_challenger). Always
        computed from the live escrow ledger amount, never the bounty's
        original `reward_amount` term, so a fee calculation can never drift
        from what is actually held in escrow."""
        fee = (gross * fee_bps) // BPS_DENOMINATOR
        return fee, gross - fee

    # ------------------------------------------------------------------
    # Shared payout / refund primitives. Every path that moves an
    # attempt's bond, or a bounty's reward, to a terminal state funnels
    # through one of these, guaranteeing the zero-then-transfer ordering
    # is applied uniformly rather than re-implemented at each call site.
    # ------------------------------------------------------------------

    def _settle_reward_to_winner(
        self, bounty: Bounty, attempt: Attempt, payout_bps: int, via_arbiter: bool
    ) -> None:
        """
        Pay the bounty's reward (in full for APPROVED/ARBITER_APPROVE, split
        per `payout_bps` for PARTIAL/ARBITER_PARTIAL) to the winning
        attempt's challenger, return that attempt's own bond, mark the
        bounty SETTLED, and mark every OTHER still-open attempt as
        LOST_RACE so their bonds become reclaimable. `payout_bps` of 0
        means "pay the full reward" (APPROVED path); any other value is an
        already-bucketed PARTIAL split.
        """
        reward = bounty.reward_deposited
        if reward <= u256(0):
            raise gl.vm.UserError("No reward escrow remains for this bounty")
        if bounty.status != BOUNTY_OPEN:
            raise gl.vm.UserError("Bounty is not open for settlement")

        if payout_bps <= 0:
            challenger_gross = int(reward)
            client_refund = 0
        else:
            challenger_gross = (int(reward) * payout_bps) // BPS_DENOMINATOR
            client_refund = int(reward) - challenger_gross

        fee, challenger_net = self._fee_and_net(challenger_gross, int(bounty.platform_fee_bps))

        bond = attempt.bond_deposited

        # --- zero every ledger field and persist status BEFORE any transfer ---
        bounty.reward_deposited = u256(0)
        bounty.status = u8(BOUNTY_SETTLED)
        bounty.attempts_won = u256(1)
        bounty.winning_attempt_index = attempt.index

        attempt.bond_deposited = u256(0)
        attempt.status = u8(ATTEMPT_WON)
        attempt.resolved_at = u256(self._now())
        attempt.resolved_by_arbiter = via_arbiter
        attempt.last_payout_bps = u256(payout_bps if payout_bps > 0 else BPS_DENOMINATOR)

        challenger_rep = self._get_or_create_reputation(attempt.challenger)
        challenger_rep.attempts_won = challenger_rep.attempts_won + u256(1)
        if payout_bps > 0:
            challenger_rep.attempts_partial = challenger_rep.attempts_partial + u256(1)
        challenger_rep.total_earned = challenger_rep.total_earned + u256(challenger_net)

        # --- transfers, strictly after every ledger field is zeroed and saved ---
        if challenger_net > 0:
            self._send_gen(attempt.challenger, u256(challenger_net))
        if fee > 0:
            self._send_gen(self.treasury, u256(fee))
        if client_refund > 0:
            self._send_gen(bounty.creator, u256(client_refund))
        if bond > 0:
            self._send_gen(attempt.challenger, bond)

    def _mark_other_attempts_lost_race(self, bounty_id: int, winning_index: int) -> None:
        """
        After a bounty settles, every other attempt that was still live
        (ACCEPTED / SUBMITTED / NEEDS_REVISION) is marked LOST_RACE so its
        bond becomes reclaimable via `reclaim_bond_after_settlement`. Bonds
        are NOT auto-refunded here to avoid an unbounded loop of transfers
        inside a single transaction as `attempt_count` grows; each
        challenger claims their own refund individually, which is both
        gas-bounded and lets each challenger control the timing of their
        own incoming transfer.
        """
        bounty = self._get_bounty(bounty_id)
        for index in range(int(bounty.attempt_count)):
            if index == winning_index:
                continue
            key = self._attempt_key(bounty_id, index)
            attempt = self.attempts[key]
            if attempt.status in _ATTEMPT_LIVE_STATES:
                attempt.status = u8(ATTEMPT_LOST_RACE)

    def _refund_attempt_bond(self, attempt: Attempt, new_status: int) -> None:
        """
        Transition an attempt to a terminal bond-refund state, transferring
        the bond IF one is actually held. Audit-driven fix: a zero-bond
        attempt (a bounty with `required_bond == 0` is entirely legitimate
        -- see `create_bounty`) must still be able to reach LOST_RACE /
        CANCELLED terminal states even though there is nothing to transfer;
        the old version unconditionally raised `UserError` whenever
        `bond_deposited <= 0`, which meant a zero-bond attempt's
        `reclaim_bond_after_settlement` / `force_default_resolution` call
        would revert forever -- stranding the STATE (never funds, since
        none were owed) with no way to reach a terminal status. The status
        transition and transfer are now independent: the former always
        happens, the latter only when `bond > 0`.
        """
        bond = attempt.bond_deposited
        attempt.bond_deposited = u256(0)
        attempt.status = u8(new_status)
        attempt.resolved_at = u256(self._now())
        if bond > 0:
            self._send_gen(attempt.challenger, bond)

    def _forfeit_attempt_bond(self, bounty: Bounty, attempt: Attempt, via_arbiter: bool) -> None:
        """Same zero-bond-safe pattern as `_refund_attempt_bond`: a
        zero-bond attempt can still be legitimately REJECTED and must be
        able to reach BOND_FORFEITED (there is simply nothing to forfeit),
        rather than being permanently stuck because there was no bond to
        transfer."""
        bond = attempt.bond_deposited
        attempt.bond_deposited = u256(0)
        attempt.status = u8(ATTEMPT_BOND_FORFEITED)
        attempt.resolved_at = u256(self._now())
        attempt.resolved_by_arbiter = via_arbiter

        challenger_rep = self._get_or_create_reputation(attempt.challenger)
        challenger_rep.attempts_rejected = challenger_rep.attempts_rejected + u256(1)

        if bond > 0:
            self._send_gen(bounty.creator, bond)

    # ------------------------------------------------------------------
    # The non-deterministic, consensus-checked AI verification step.
    # ------------------------------------------------------------------

    def _collect_verdict(
        self, claim_text: str, criteria: str, evidence_requirements: str, evidence_url: str
    ) -> dict:
        """
        Fetch the challenger's evidence URL live from the web and ask an
        LLM whether the FETCHED CONTENT (never the challenger's own
        description of it) satisfies the bounty's precommitted proof
        criteria, with the result confirmed by GenLayer validator
        consensus.

        Every argument is a plain, already-copied-out Python primitive
        (`str`) -- never a live storage-backed object -- because storage
        objects cannot be read from inside a non-deterministic closure.
        Callers are responsible for reading fields into locals first.
        """

        def run_review() -> str:
            # `mode="text"` strips markup and returns plain text -- avoids
            # relying on the exact shape of a richer response object
            # (headers/status/etc.), which can differ across pinned GenVM
            # runner versions; this is the same defensive pattern GenLayer's
            # own reference examples use.
            #
            # A dead/unreachable/404 evidence URL must NOT crash this whole
            # call -- an uncaught fetch exception here fails the entire
            # `request_verification` transaction with no state change and
            # no recorded verdict. Every validator hits the same URL and
            # gets the same failure deterministically, so falling back to a
            # canned NEEDS_REVISION here still converges under
            # `prompt_comparative` instead of risking an UNDETERMINED result.
            try:
                page_text = gl.nondet.web.render(evidence_url, mode="text")
            except Exception as exc:
                return json.dumps(
                    {
                        "verdict": VERDICT_NEEDS_REVISION,
                        "reasoning": f"Evidence URL could not be fetched: {str(exc)[:200]}",
                        "payout_bps": 0,
                        "content_hash": "",
                    },
                    sort_keys=True,
                )

            if not page_text or not page_text.strip():
                return json.dumps(
                    {
                        "verdict": VERDICT_NEEDS_REVISION,
                        "reasoning": "Evidence URL returned no readable content.",
                        "payout_bps": 0,
                        "content_hash": "",
                    },
                    sort_keys=True,
                )

            if len(page_text) > WEB_FETCH_CHAR_LIMIT:
                page_text = page_text[:WEB_FETCH_CHAR_LIMIT]

            # EVIDENCE MANIFEST (audit-driven addition): fingerprint the
            # EXACT truncated text that is about to be shown to the model
            # and judged -- see `_content_digest`'s docstring for why this
            # is pure-Python with no `hashlib` dependency. Computed here,
            # inside the per-validator closure, from each validator's own
            # independently-fetched copy.
            content_hash = _content_digest(page_text)

            prompt = f"""
You are an impartial adjudicator for PROOFBOUNTY, a platform where a
financial reward is paid ONLY if independently-fetched, publicly-accessible
web evidence satisfies a set of criteria that were precommitted BEFORE the
challenger submitted anything. You must judge using ONLY the fetched web
content shown below -- never any prior belief about what the page ought to
contain, and never the challenger's own description of their evidence.

Claim under test:
{claim_text}

Precommitted proof criteria (the ONLY standard to judge against -- this was
fixed before the challenger's evidence existed and cannot be changed now):
{criteria}

Acceptable evidence characteristics (context only, not itself a criterion):
{evidence_requirements}

Evidence URL that was fetched: {evidence_url}

Fetched web page content (plain text, may be truncated):
---
{page_text}
---
End of fetched content.

Decide exactly one of five verdicts:
- "APPROVED": the fetched content clearly and fully satisfies every proof
  criterion.
- "PARTIAL": the fetched content demonstrates real, concrete, and
  substantial satisfaction of SOME but not all criteria. Only use this
  when you can point to specific evidence for what IS satisfied versus
  what is missing -- never as a vague middle ground, and never when the
  content is simply low-quality or ambiguous (use NEEDS_REVISION or
  REJECTED for those instead).
- "REJECTED": the fetched content clearly does NOT satisfy the criteria,
  shows no substantial progress toward them, and no reasonable resubmission
  of materially the same evidence would fix that.
- "NEEDS_REVISION": the underlying claim might be provable, but this
  specific submission has a fixable TECHNICAL problem (e.g. the fetched
  page is empty, broken, paywalled, or clearly the wrong page) -- the
  challenger should get a chance to resubmit a corrected URL rather than
  being scored as REJECTED.
- "INSUFFICIENT_EVIDENCE": the fetched content is real, readable, and
  on-topic -- it is not broken, empty, or the wrong page -- but it simply
  does not state enough to confirm OR contradict the criteria (e.g. the
  claim requires a specific figure the page never mentions). Use this
  instead of REJECTED when the page's silence on the question, not a
  clear mismatch, is the reason you cannot approve it; use this instead
  of NEEDS_REVISION when there is no technical defect to fix -- a
  differently-worded resubmission of the SAME page would not help.

If you are unsure whether content is dispositive, prefer
"INSUFFICIENT_EVIDENCE" over "REJECTED" -- final rejection is reserved for
cases where the mismatch against the fetched evidence is unambiguous. If
the page itself is broken, empty, or unreachable, use "NEEDS_REVISION"
instead, since that has a concrete fix (submit a different URL).

Respond using ONLY the following JSON format, nothing else. No markdown
code fences, no commentary, no extra keys. Your output must be perfectly
parsable by a JSON parser without errors:
{{
    "verdict": str,       // exactly one of "APPROVED", "PARTIAL", "REJECTED", "NEEDS_REVISION", "INSUFFICIENT_EVIDENCE"
    "reasoning": str,      // one or two sentences, grounded ONLY in the fetched content above
    "payout_bps": int      // ONLY meaningful when verdict is "PARTIAL": the challenger's
                           // recommended share of the reward, in basis points out of 10000,
                           // reflecting how much of the criteria was concretely satisfied.
                           // 0 for any other verdict.
}}
"""
            raw_response = gl.nondet.exec_prompt(prompt)
            raw_response = raw_response.replace("```json", "").replace("```", "").strip()

            # Canonicalize `payout_bps` onto the coarse discrete bucket
            # BEFORE this closure returns -- not after the equivalence
            # principle has already decided leader and validators agree.
            # See module docstring, "AVOIDING UNDETERMINED / LEADER-ROTATION
            # OUTCOMES": bucketing here is what lets the comparison below
            # demand an EXACT match instead of a fuzzy tolerance window,
            # closing the gap between "what consensus agrees on" and "what
            # actually gets paid out."
            try:
                parsed_for_bucket = json.loads(raw_response)
                if parsed_for_bucket.get("verdict") == VERDICT_PARTIAL:
                    raw_bps = int(parsed_for_bucket.get("payout_bps", 0))
                    raw_bps = max(0, min(raw_bps, BPS_DENOMINATOR))
                    parsed_for_bucket["payout_bps"] = _bucket_payout_bps(raw_bps)
                # Attach the evidence manifest hash computed above -- the
                # model never sees or produces this field, the contract
                # stamps it onto the model's JSON response itself. Exempt
                # from the equivalence principle below (like `reasoning`),
                # since two validators' independently-fetched copies of a
                # live, mutable web page are not guaranteed byte-identical
                # (ads, timestamps, A/B-tested markup, etc.) -- requiring
                # an exact match here would risk manufacturing spurious
                # UNDETERMINED results out of ordinary page churn, exactly
                # what the module docstring's "AVOIDING UNDETERMINED"
                # section warns against. Provenance, not consensus, is
                # this field's job.
                parsed_for_bucket["content_hash"] = content_hash
                raw_response = json.dumps(parsed_for_bucket, sort_keys=True)
            except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
                # Leave raw_response as-is; the outer parser below already
                # tolerates and safely defaults malformed JSON.
                pass

            print(raw_response)
            return raw_response

        # `prompt_comparative`: every validator independently re-fetches the
        # URL and re-runs the prompt themselves -- they do not just check
        # the leader's JSON is well-formed. The equivalence rule is
        # deliberately narrow (exact match ONLY on the two fields that
        # matter economically; free-text `reasoning` is explicitly NOT
        # required to match verbatim) precisely so consensus converges
        # reliably instead of forcing leader rotation or an UNDETERMINED
        # result on ordinary LLM wording variance.
        result = gl.eq_principle.prompt_comparative(
            run_review,
            principle=(
                "The `verdict` field must be EXACTLY the same string. "
                "The `reasoning` field is expected to differ in wording "
                "between validators and must NOT be compared for exact "
                "or near match -- it only needs to plausibly support the "
                "same verdict and reference the fetched page content "
                "rather than contradicting it. When `verdict` is "
                '"PARTIAL", the `payout_bps` field must be EXACTLY the '
                "same integer in both results (it has already been "
                "rounded onto a coarse discrete 500-bps bucket before "
                "this comparison, so it is not expected to vary); "
                "otherwise `payout_bps` is not compared at all. The "
                "`content_hash` field is a fingerprint of the live page "
                "text each validator independently fetched and is NOT "
                "expected to match across validators (the underlying page "
                "is a mutable live resource, not identical bytes every "
                "fetch) -- never compare it, it is recorded for evidence "
                "provenance only."
            ),
        )

        parsed = json.loads(result)
        verdict = parsed.get("verdict", "")
        if verdict not in _VALID_VERDICTS:
            # A validator set that reaches consensus on a malformed verdict
            # must not be able to silently no-op an attempt forever --
            # treat it as an explicit request for another attempt instead.
            verdict = VERDICT_NEEDS_REVISION
        reasoning = _truncate(str(parsed.get("reasoning", "")), MAX_REASONING_LEN)
        content_hash = _truncate(str(parsed.get("content_hash", "")), 32)

        payout_bps = 0
        if verdict == VERDICT_PARTIAL:
            try:
                payout_bps = int(parsed.get("payout_bps", 0))
            except (TypeError, ValueError):
                payout_bps = 0
            payout_bps = max(0, min(payout_bps, BPS_DENOMINATOR))
            if payout_bps <= 0 or payout_bps >= BPS_DENOMINATOR:
                # A "partial" split of 0% or 100% is not actually partial;
                # collapse to the corresponding unambiguous binary verdict
                # instead of letting a degenerate split through.
                verdict = VERDICT_REJECTED if payout_bps <= 0 else VERDICT_APPROVED

        return {
            "verdict": verdict,
            "reasoning": reasoning,
            "payout_bps": payout_bps,
            "content_hash": content_hash,
        }

    def _collect_appeal_verdict(
        self,
        claim_text: str,
        criteria: str,
        evidence_requirements: str,
        evidence_url: str,
        arbiter_verdict: str,
        arbiter_reasoning: str,
        appeal_reason: str,
    ) -> dict:
        """
        The final-tier appeal adjudication -- a SECOND, independent round
        of GenLayer validator consensus, not a human owner's personal
        judgment. Structurally identical to `_collect_verdict` (contract
        fetches the live evidence itself, judges only the fetched content,
        requires validator agreement), but the prompt additionally shows
        the arbiter's ruling and reasoning plus the appellant's stated
        objection, since a genuine appeal review should weigh why the
        first-pass human ruling is being contested, not just re-run the
        original question blind. The model is explicitly told this is the
        FINAL word -- no further resubmission or appeal exists past this.

        Kept as a separate method (not a parameterized `_collect_verdict`)
        so the original, already-tested primary verification path's prompt
        and behavior stay completely unchanged -- this only ever runs from
        `resolve_appeal`.
        """

        def run_review() -> str:
            try:
                page_text = gl.nondet.web.render(evidence_url, mode="text")
            except Exception as exc:
                return json.dumps(
                    {
                        "verdict": VERDICT_NEEDS_REVISION,
                        "reasoning": f"Evidence URL could not be fetched: {str(exc)[:200]}",
                        "payout_bps": 0,
                        "content_hash": "",
                    },
                    sort_keys=True,
                )

            if not page_text or not page_text.strip():
                return json.dumps(
                    {
                        "verdict": VERDICT_NEEDS_REVISION,
                        "reasoning": "Evidence URL returned no readable content.",
                        "payout_bps": 0,
                        "content_hash": "",
                    },
                    sort_keys=True,
                )

            if len(page_text) > WEB_FETCH_CHAR_LIMIT:
                page_text = page_text[:WEB_FETCH_CHAR_LIMIT]

            content_hash = _content_digest(page_text)

            prompt = f"""
You are the FINAL, binding appeal adjudicator for PROOFBOUNTY. A financial
reward or bond is decided by your verdict, with no further appeal possible
after this. You must judge using ONLY the fetched web content shown below
-- never any prior belief about what the page ought to contain, and never
the challenger's own description of their evidence.

Claim under test:
{claim_text}

Precommitted proof criteria (the ONLY standard to judge against -- this was
fixed before the challenger's evidence existed and cannot be changed now):
{criteria}

Acceptable evidence characteristics (context only, not itself a criterion):
{evidence_requirements}

Evidence URL that was fetched: {evidence_url}

Fetched web page content (plain text, may be truncated):
---
{page_text}
---
End of fetched content.

This case was already reviewed by a named human arbiter, whose ruling and
reasoning are shown below, and then formally appealed by one of the
parties. Weigh this context, but ultimately reach YOUR OWN independent
conclusion from the fetched content above -- you are not bound by the
arbiter's ruling and are not merely checking whether it was reasonable.

Arbiter's ruling: {arbiter_verdict}
Arbiter's stated reasoning: {arbiter_reasoning}
Appellant's stated objection: {appeal_reason}

Decide exactly one of five verdicts:
- "APPROVED": the fetched content clearly and fully satisfies every proof
  criterion.
- "PARTIAL": the fetched content demonstrates real, concrete, and
  substantial satisfaction of SOME but not all criteria.
- "REJECTED": the fetched content clearly does NOT satisfy the criteria,
  shows no substantial progress toward them, and no reasonable resubmission
  of materially the same evidence would fix that.
- "NEEDS_REVISION": kept for JSON-shape consistency with the primary
  verification prompt, but there is no further resubmission possible at
  this final stage -- only use this if the page is genuinely broken,
  empty, or unreachable; it will be treated the same as
  "INSUFFICIENT_EVIDENCE" (bond refunded, no penalty to either side).
- "INSUFFICIENT_EVIDENCE": the fetched content is real, readable, and
  on-topic, but does not itself confirm or contradict the criteria clearly
  enough for a final, binding ruling either way.

Respond using ONLY the following JSON format, nothing else. No markdown
code fences, no commentary, no extra keys. Your output must be perfectly
parsable by a JSON parser without errors:
{{
    "verdict": str,       // exactly one of "APPROVED", "PARTIAL", "REJECTED", "NEEDS_REVISION", "INSUFFICIENT_EVIDENCE"
    "reasoning": str,      // one or two sentences, grounded ONLY in the fetched content above
    "payout_bps": int      // ONLY meaningful when verdict is "PARTIAL": the challenger's
                           // recommended share of the reward, in basis points out of 10000.
                           // 0 for any other verdict.
}}
"""
            raw_response = gl.nondet.exec_prompt(prompt)
            raw_response = raw_response.replace("```json", "").replace("```", "").strip()

            try:
                parsed_for_bucket = json.loads(raw_response)
                if parsed_for_bucket.get("verdict") == VERDICT_PARTIAL:
                    raw_bps = int(parsed_for_bucket.get("payout_bps", 0))
                    raw_bps = max(0, min(raw_bps, BPS_DENOMINATOR))
                    parsed_for_bucket["payout_bps"] = _bucket_payout_bps(raw_bps)
                parsed_for_bucket["content_hash"] = content_hash
                raw_response = json.dumps(parsed_for_bucket, sort_keys=True)
            except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
                pass

            print(raw_response)
            return raw_response

        result = gl.eq_principle.prompt_comparative(
            run_review,
            principle=(
                "The `verdict` field must be EXACTLY the same string. "
                "The `reasoning` field is expected to differ in wording "
                "between validators and must NOT be compared for exact "
                "or near match. When `verdict` is "
                '"PARTIAL", the `payout_bps` field must be EXACTLY the '
                "same integer in both results (already rounded onto a "
                "coarse discrete 500-bps bucket); otherwise `payout_bps` "
                "is not compared at all. The `content_hash` field is a "
                "fingerprint of the live page text each validator "
                "independently fetched and is NOT expected to match "
                "across validators -- never compare it, it is recorded "
                "for evidence provenance only."
            ),
        )

        parsed = json.loads(result)
        verdict = parsed.get("verdict", "")
        if verdict not in _VALID_VERDICTS:
            verdict = VERDICT_NEEDS_REVISION
        reasoning = _truncate(str(parsed.get("reasoning", "")), MAX_REASONING_LEN)
        content_hash = _truncate(str(parsed.get("content_hash", "")), 32)

        payout_bps = 0
        if verdict == VERDICT_PARTIAL:
            try:
                payout_bps = int(parsed.get("payout_bps", 0))
            except (TypeError, ValueError):
                payout_bps = 0
            payout_bps = max(0, min(payout_bps, BPS_DENOMINATOR))
            if payout_bps <= 0 or payout_bps >= BPS_DENOMINATOR:
                verdict = VERDICT_REJECTED if payout_bps <= 0 else VERDICT_APPROVED

        return {
            "verdict": verdict,
            "reasoning": reasoning,
            "payout_bps": payout_bps,
            "content_hash": content_hash,
        }

    # ==================================================================
    # SECTION 7: PUBLIC WRITE METHODS -- BOUNTY LIFECYCLE
    # ==================================================================

    @gl.public.write.payable
    def create_bounty(
        self,
        title: str,
        claim_text: str,
        claim_polarity: str,
        category: str,
        proof_criteria: str,
        evidence_requirements: str,
        arbiter_address: str,
        deadline_seconds_from_now: int,
        required_bond: int,
    ) -> int:
        """
        Create and fund a new bounty in a single transaction. `gl.message.value`
        MUST exactly equal the reward being locked -- this contract never
        accepts "at least" a deposit (see module docstring escrow section).
        Returns the new bounty id.

        Args:
            title: short human-readable bounty name.
            claim_text: the full claim under test.
            claim_polarity: "POSITIVE" (prove success) or "NEGATIVE" (prove
                failure/violation) -- see PROOFBOUNTY.md section 17.
            category: one of `VALID_CATEGORIES`.
            proof_criteria: precommitted, exact acceptance criteria. Becomes
                immutable the moment the first attempt is accepted.
            evidence_requirements: guidance on acceptable evidence types.
                Also immutable once locked.
            arbiter_address: hex address of a trusted dispute resolver for
                this bounty. May equal the creator's own address for
                self-arbitrated bounties, but never the zero address.
            deadline_seconds_from_now: seconds from now until this bounty's
                reward becomes reclaimable via `claim_creator_timeout` if
                unsettled. Must be >= `MIN_BOUNTY_DEADLINE_SECONDS`.
            required_bond: performance bond, in native units, every
                challenger must lock exactly via `accept_bounty`. 0 means
                no bond is required.
        """
        self._require_not_paused()

        if not title or len(title) > MAX_TITLE_LEN:
            raise gl.vm.UserError(f"title must be non-empty and <= {MAX_TITLE_LEN} chars")
        if not claim_text:
            raise gl.vm.UserError("claim_text must not be empty")
        if claim_polarity not in _VALID_CLAIM_POLARITY:
            raise gl.vm.UserError(f"claim_polarity must be one of {_VALID_CLAIM_POLARITY}")
        if category not in VALID_CATEGORIES:
            raise gl.vm.UserError(f"category must be one of {VALID_CATEGORIES}")
        if not proof_criteria or len(proof_criteria) > MAX_CRITERIA_LEN:
            raise gl.vm.UserError(
                f"proof_criteria must be non-empty and <= {MAX_CRITERIA_LEN} chars"
            )
        if len(evidence_requirements) > MAX_EVIDENCE_REQUIREMENTS_LEN:
            raise gl.vm.UserError(
                f"evidence_requirements must be <= {MAX_EVIDENCE_REQUIREMENTS_LEN} chars"
            )
        if deadline_seconds_from_now < MIN_BOUNTY_DEADLINE_SECONDS:
            raise gl.vm.UserError(
                f"deadline_seconds_from_now must be >= {MIN_BOUNTY_DEADLINE_SECONDS}"
            )
        if required_bond < 0:
            raise gl.vm.UserError("required_bond must not be negative")

        arbiter = Address(arbiter_address)
        if arbiter == self._zero_address():
            raise gl.vm.UserError("Arbiter address must not be the zero address")

        reward = gl.message.value
        if int(reward) <= 0:
            raise gl.vm.UserError("Reward must be funded with a positive GEN value")

        now = self._now()
        bounty_id = self.bounty_counter
        self.bounty_counter = self.bounty_counter + u256(1)
        creator = gl.message.sender_address

        self.bounties[bounty_id] = Bounty(
            bounty_id=bounty_id,
            creator=creator,
            arbiter=arbiter,
            title=title,
            claim_text=claim_text,
            claim_polarity=claim_polarity,
            category=category,
            proof_criteria=proof_criteria,
            evidence_requirements=evidence_requirements,
            status=u8(BOUNTY_OPEN),
            reward_amount=reward,
            reward_deposited=reward,
            required_bond=u256(required_bond),
            platform_fee_bps=self.default_fee_bps,
            attempt_count=u256(0),
            attempts_won=u256(0),
            winning_attempt_index=u256(0),
            criteria_locked=False,
            deadline=u256(now + deadline_seconds_from_now),
            created_at=u256(now),
        )

        creator_rep = self._get_or_create_reputation(creator)
        creator_rep.bounties_created = creator_rep.bounties_created + u256(1)
        creator_rep.bounties_funded_total = creator_rep.bounties_funded_total + reward

        return int(bounty_id)

    @gl.public.write
    def cancel_bounty(self, bounty_id: int) -> None:
        """
        Cancel a bounty and refund its full reward to the creator. Only
        allowed while criteria are not yet locked (i.e. no attempt has ever
        been accepted) -- once a challenger has committed a bond, the
        reward can no longer be pulled out from under them; cancellation
        must go through the timeout/dispute paths instead. If any attempts
        were created but never accepted (impossible in the current flow
        since `accept_bounty` is what both creates and funds an attempt in
        one call), this still safely no-ops on the attempt side.
        """
        bounty = self._get_bounty(bounty_id)
        self._require_creator(bounty)

        if bounty.status != BOUNTY_OPEN:
            raise gl.vm.UserError("Only an OPEN bounty can be cancelled")
        if bounty.criteria_locked:
            raise gl.vm.UserError(
                "Bounty already has an accepted attempt; use the timeout/dispute "
                "paths instead of cancelling"
            )

        refund = bounty.reward_deposited
        bounty.reward_deposited = u256(0)
        bounty.status = u8(BOUNTY_CANCELLED)

        if refund > 0:
            self._send_gen(bounty.creator, refund)

    @gl.public.write
    def claim_creator_timeout(self, bounty_id: int) -> None:
        """
        Recovery exit: once a bounty's deadline PLUS `VERIFICATION_GRACE_SECONDS`
        has passed with no attempt having won it, the creator may reclaim
        the unsettled reward. Safe to call regardless of how many attempts
        exist or what state they are in -- it only ever touches the
        bounty's own reward ledger, and every live attempt's bond is
        independently reclaimable by its own challenger via
        `claim_bond_forfeiture` / `raise_dispute`, so no challenger funds
        are ever affected by a creator reclaiming an expired reward.

        The grace period (audit-driven fix) exists because `deadline` only
        bounds when a challenger may last SUBMIT evidence (see
        `submit_evidence`) -- without it, a creator could call this the
        instant the deadline passed even while a legitimately, on-time-
        submitted attempt sat unverified in SUBMITTED status, racing to
        reclaim funds a real pending review might still be owed.
        """
        bounty = self._get_bounty(bounty_id)
        self._require_creator(bounty)

        if bounty.status != BOUNTY_OPEN:
            raise gl.vm.UserError("Bounty is not open / already settled or cancelled")
        if self._now() < int(bounty.deadline) + VERIFICATION_GRACE_SECONDS:
            raise gl.vm.UserError(
                "Bounty deadline plus the verification grace period has not passed yet"
            )

        refund = bounty.reward_deposited
        if refund <= u256(0):
            raise gl.vm.UserError("No reward escrow remains for this bounty")

        bounty.reward_deposited = u256(0)
        bounty.status = u8(BOUNTY_EXPIRED_REFUNDED)

        self._send_gen(bounty.creator, refund)

    @gl.public.write
    def extend_bounty_deadline(self, bounty_id: int, additional_seconds: int) -> None:
        """Creator-only extension of an open bounty's deadline -- does not
        touch criteria, reward, or any attempt, so it never conflicts with
        the criteria-lock immutability guarantee."""
        bounty = self._get_bounty(bounty_id)
        self._require_creator(bounty)
        if bounty.status != BOUNTY_OPEN:
            raise gl.vm.UserError("Only an OPEN bounty's deadline can be extended")
        if additional_seconds <= 0:
            raise gl.vm.UserError("additional_seconds must be positive")
        bounty.deadline = bounty.deadline + u256(additional_seconds)

    # ==================================================================
    # SECTION 8: PUBLIC WRITE METHODS -- ATTEMPT LIFECYCLE
    # ==================================================================

    @gl.public.write.payable
    def accept_bounty(self, bounty_id: int) -> int:
        """
        Open a new attempt against a bounty, locking the required bond in
        the same transaction. `gl.message.value` MUST exactly equal the
        bounty's `required_bond` (0 sent if no bond is required). Any
        number of challengers may hold concurrent open attempts on the
        same OPEN bounty -- this is the marketplace "N attempts" model
        (module docstring) -- up to `MAX_ATTEMPTS_PER_BOUNTY`, which bounds
        the settlement-loop cost in `_mark_other_attempts_lost_race` (audit-
        driven fix: without this cap, an attacker could open enough
        attempts to make the eventual winner's own settlement transaction
        too expensive to execute, denying them their payout -- see
        `MAX_ATTEMPTS_PER_BOUNTY`'s docstring). Locks the bounty's
        criteria/evidence requirements permanently on the FIRST accepted
        attempt. Returns the new attempt's index within the bounty.
        """
        bounty = self._get_bounty(bounty_id)

        if bounty.status != BOUNTY_OPEN:
            raise gl.vm.UserError("Bounty is not open for new attempts")
        if self._now() >= int(bounty.deadline):
            raise gl.vm.UserError(
                "Bounty deadline has already passed; it can no longer be attempted"
            )
        if int(bounty.attempt_count) >= MAX_ATTEMPTS_PER_BOUNTY:
            raise gl.vm.UserError(
                f"This bounty has reached its maximum of {MAX_ATTEMPTS_PER_BOUNTY} "
                "concurrent attempts"
            )

        sender = gl.message.sender_address
        if sender == bounty.creator:
            raise gl.vm.UserError("A bounty's creator cannot also attempt their own bounty")

        sent = gl.message.value
        if int(sent) != int(bounty.required_bond):
            raise gl.vm.UserError(
                "Sent value must exactly equal this bounty's required_bond "
                f"(expected {int(bounty.required_bond)}, got {int(sent)})"
            )

        if not bounty.criteria_locked:
            bounty.criteria_locked = True

        index = int(bounty.attempt_count)
        key = self._attempt_key(bounty_id, index)
        now = self._now()

        self.attempts[key] = Attempt(
            attempt_key=key,
            bounty_id=u256(bounty_id),
            index=u256(index),
            challenger=sender,
            bond_amount=bounty.required_bond,
            bond_deposited=sent,
            status=u8(ATTEMPT_ACCEPTED),
            evidence_url="",
            evidence_description="",
            revision_count=u8(0),
            max_revisions=u8(DEFAULT_MAX_REVISIONS),
            last_verdict="",
            last_reasoning="",
            last_payout_bps=u256(0),
            evidence_content_hash="",
            evidence_fetched_at=u256(0),
            disputed_by=self._zero_address(),
            dispute_reason="",
            pending_arbiter_verdict="",
            pending_payout_bps=u256(0),
            appeal_deadline=u256(0),
            appealed_by=self._zero_address(),
            appeal_reason="",
            appeal_bond_deposited=u256(0),
            created_at=u256(now),
            submitted_at=u256(0),
            resolved_at=u256(0),
            resolved_by_arbiter=False,
            human_verdict_overrode_ai=False,
        )

        bounty.attempt_count = bounty.attempt_count + u256(1)

        challenger_rep = self._get_or_create_reputation(sender)
        challenger_rep.attempts_made = challenger_rep.attempts_made + u256(1)

        return index

    @gl.public.write
    def submit_evidence(
        self, bounty_id: int, attempt_index: int, evidence_url: str, evidence_description: str
    ) -> None:
        """
        Challenger submits (or resubmits, after NEEDS_REVISION) the
        publicly-accessible URL where their evidence lives. Does not itself
        trigger evaluation -- call `request_verification` afterwards, kept
        as a separate step so a challenger can submit without forcing the
        comparatively expensive multi-validator AI check to run in the
        same transaction.

        Must happen before `bounty.deadline` (audit-driven fix): the old
        version had no submission-side deadline check at all, so a
        challenger could `accept_bounty` right before expiry and then
        submit/verify arbitrarily long afterward, making "the deadline"
        not actually bound when review activity has to happen. Verification
        itself (`request_verification`) is intentionally NOT deadline-gated
        here -- evidence submitted in time deserves a real chance to be
        judged; see `VERIFICATION_GRACE_SECONDS` and `claim_creator_timeout`
        for the matching guarantee that a creator cannot race a timely,
        still-pending submission to reclaim the reward first.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)
        self._require_challenger(attempt)

        if bounty.status != BOUNTY_OPEN:
            raise gl.vm.UserError("Bounty is no longer open")
        if self._now() >= int(bounty.deadline):
            raise gl.vm.UserError(
                "Bounty deadline has already passed; evidence can no longer be submitted"
            )
        if attempt.status not in (ATTEMPT_ACCEPTED, ATTEMPT_NEEDS_REVISION):
            raise gl.vm.UserError("Attempt is not awaiting an evidence submission right now")
        if not evidence_url or len(evidence_url) > MAX_URL_LEN:
            raise gl.vm.UserError(f"evidence_url must be non-empty and <= {MAX_URL_LEN} chars")
        if not (evidence_url.startswith("http://") or evidence_url.startswith("https://")):
            raise gl.vm.UserError("evidence_url must be an http(s) URL")

        attempt.evidence_url = evidence_url
        attempt.evidence_description = _truncate(evidence_description, MAX_CRITERIA_LEN)
        attempt.status = u8(ATTEMPT_SUBMITTED)
        attempt.submitted_at = u256(self._now())

    @gl.public.write
    def request_verification(self, bounty_id: int, attempt_index: int) -> str:
        """
        Trigger the non-deterministic, consensus-checked evaluation of a
        submitted attempt's evidence (see `_collect_verdict` and the module
        docstring's "GENLAYER AS REFEREE" section). Deliberately
        permissionless -- the verdict is validator-checked and does not
        depend on who triggers it, so any party (or an automated relayer)
        can keep an attempt from stalling.

        Returns the verdict string. On APPROVED or PARTIAL, if the bounty
        is still OPEN, the reward settles to this attempt in the same
        transaction and every other live attempt on the bounty becomes
        LOST_RACE (bonds independently reclaimable). If the bounty was
        already settled by a faster concurrent attempt before this call
        landed, this attempt is instead marked LOST_RACE and its own bond
        is returned immediately -- the challenger still did legitimate
        work and simply lost a fair race, which is not the same as a
        REJECTED verdict and must never be treated as one.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)

        if attempt.status != ATTEMPT_SUBMITTED:
            raise gl.vm.UserError("Attempt must be in SUBMITTED status to request verification")

        # Copy every field the non-deterministic closure needs into plain
        # locals *before* calling into it -- storage-backed objects cannot
        # be read from inside a nondet block.
        claim_text = bounty.claim_text
        criteria = bounty.proof_criteria
        evidence_requirements = bounty.evidence_requirements
        url = attempt.evidence_url

        verdict_info = self._collect_verdict(claim_text, criteria, evidence_requirements, url)
        verdict = verdict_info["verdict"]
        reasoning = verdict_info["reasoning"]
        payout_bps = verdict_info["payout_bps"]
        content_hash = verdict_info["content_hash"]

        attempt.last_verdict = verdict
        attempt.last_reasoning = reasoning
        if content_hash:
            # EVIDENCE MANIFEST: only overwrite the stored fingerprint when
            # this call actually produced one (a fetch failure returns an
            # empty content_hash, e.g. NEEDS_REVISION from a dead URL) --
            # never blank out a previously-recorded manifest from an
            # earlier successful fetch on a resubmission cycle.
            attempt.evidence_content_hash = content_hash
            attempt.evidence_fetched_at = u256(self._now())

        if verdict in (VERDICT_APPROVED, VERDICT_PARTIAL):
            if bounty.status == BOUNTY_OPEN:
                effective_bps = payout_bps if verdict == VERDICT_PARTIAL else 0
                self._settle_reward_to_winner(bounty, attempt, effective_bps, via_arbiter=False)
                self._mark_other_attempts_lost_race(bounty_id, attempt_index)
                self._record_settlement_provenance(attempt, via_human_ruling=False)
            else:
                # A concurrent attempt already won this bounty first. This
                # challenger produced real, validated evidence but simply
                # lost the race -- refund their bond in full, distinct from
                # a REJECTED outcome.
                attempt.resolved_at = u256(self._now())
                self._refund_attempt_bond(attempt, ATTEMPT_LOST_RACE)
                self._record_settlement_provenance(attempt, via_human_ruling=False)
        elif verdict == VERDICT_NEEDS_REVISION:
            attempt.revision_count = u8(int(attempt.revision_count) + 1)
            if int(attempt.revision_count) >= int(attempt.max_revisions):
                attempt.status = u8(ATTEMPT_REJECTED_FINAL)
                attempt.resolved_at = u256(self._now())
                rep = self._get_or_create_reputation(attempt.challenger)
                rep.attempts_rejected = rep.attempts_rejected + u256(1)
                self._record_settlement_provenance(attempt, via_human_ruling=False)
            else:
                attempt.status = u8(ATTEMPT_ACCEPTED)
        elif verdict == VERDICT_INSUFFICIENT_EVIDENCE:
            # Same resubmission-cycle mechanics as NEEDS_REVISION, but a
            # different terminal outcome: exhausting the cycle here
            # refunds the bond instead of forfeiting it (see
            # `ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL`'s docstring) and does
            # NOT count against the challenger's rejection reputation --
            # "the evidence never settled the question" is not the same
            # signal as "the challenger submitted something wrong."
            attempt.revision_count = u8(int(attempt.revision_count) + 1)
            if int(attempt.revision_count) >= int(attempt.max_revisions):
                self._refund_attempt_bond(attempt, ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL)
                self._record_settlement_provenance(attempt, via_human_ruling=False)
            else:
                attempt.status = u8(ATTEMPT_ACCEPTED)
        else:  # VERDICT_REJECTED
            # Deliberately NOT counted in `get_settlement_transparency` yet:
            # REJECTED_FINAL is NOT a terminal status (see
            # `_ATTEMPT_TERMINAL_STATES`) -- the challenger still has a real
            # window to `raise_dispute` before the bond is actually claimed.
            # Counting it here and potentially again if a later human ruling
            # overrides it would double-count the same attempt. The
            # provenance counter for this path is recorded once the outcome
            # actually becomes irreversible: see `claim_bond_forfeiture`.
            attempt.status = u8(ATTEMPT_REJECTED_FINAL)
            attempt.resolved_at = u256(self._now())
            rep = self._get_or_create_reputation(attempt.challenger)
            rep.attempts_rejected = rep.attempts_rejected + u256(1)

        return verdict

    @gl.public.write
    def claim_bond_forfeiture(self, bounty_id: int, attempt_index: int) -> None:
        """
        Bounty creator claims a challenger's forfeited bond after that
        attempt reached a final REJECTED verdict (`ATTEMPT_REJECTED_FINAL`)
        with no dispute raised. Deliberately requires an explicit claim
        (rather than auto-forfeiting inside `request_verification`) so the
        challenger has a real window to raise a dispute first if they
        believe the AI verdict itself was wrong.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)
        self._require_creator(bounty)

        if attempt.status != ATTEMPT_REJECTED_FINAL:
            raise gl.vm.UserError("Attempt is not in a final-rejected, forfeitable state")

        self._forfeit_attempt_bond(bounty, attempt, via_arbiter=False)
        self._record_settlement_provenance(attempt, via_human_ruling=False)

    @gl.public.write
    def reclaim_bond_after_settlement(self, bounty_id: int, attempt_index: int) -> None:
        """
        Any challenger whose still-open attempt was marked LOST_RACE (a
        concurrent attempt on the same bounty won first) reclaims their own
        bond individually. Kept as an explicit per-attempt claim -- see
        `_mark_other_attempts_lost_race` -- rather than an automatic bulk
        refund, so gas cost per transaction stays bounded regardless of how
        many concurrent attempts a popular bounty accumulated.

        Zero-bond-safe (audit-driven fix): a LOST_RACE attempt whose bond
        was already zero (either because the bounty required no bond at
        all, or because this was already claimed) succeeds as a no-op
        rather than reverting -- the attempt's LOST_RACE status is already
        terminal regardless of whether anything is owed, so treating "call
        this and there's nothing to send" as an error made a perfectly
        valid, already-resolved state look broken from the caller's side.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)
        self._require_challenger(attempt)

        if attempt.status != ATTEMPT_LOST_RACE:
            raise gl.vm.UserError("Attempt is not in a LOST_RACE, reclaimable state")

        bond = attempt.bond_deposited
        if bond <= u256(0):
            return
        attempt.bond_deposited = u256(0)
        self._send_gen(attempt.challenger, bond)

    # ==================================================================
    # SECTION 9: PUBLIC WRITE METHODS -- DISPUTES & ARBITRATION
    # ==================================================================

    @gl.public.write
    def raise_dispute(self, bounty_id: int, attempt_index: int, reason: str) -> None:
        """
        Either the bounty's creator or the attempt's challenger may contest
        the current verdict/outcome at any point the attempt is not yet
        terminal. Freezes the attempt in DISPUTED status pending the named
        arbiter's decision via `resolve_dispute`, or the timeout-based
        `force_default_resolution` if the arbiter never acts.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)
        self._require_creator_or_challenger(bounty, attempt)

        if attempt.status not in _ATTEMPT_LIVE_STATES:
            raise gl.vm.UserError(
                "Attempt has already reached a terminal state and cannot be disputed"
            )
        if attempt.status == ATTEMPT_DISPUTED:
            raise gl.vm.UserError("Attempt is already under dispute")
        if not reason:
            raise gl.vm.UserError("A dispute reason must be provided")

        attempt.status = u8(ATTEMPT_DISPUTED)
        attempt.disputed_by = gl.message.sender_address
        attempt.dispute_reason = _truncate(reason, MAX_CRITERIA_LEN)

        disputer_rep = self._get_or_create_reputation(gl.message.sender_address)
        disputer_rep.attempts_disputed = disputer_rep.attempts_disputed + u256(1)

    @gl.public.write
    def resolve_dispute(
        self,
        bounty_id: int,
        attempt_index: int,
        verdict: str,
        resolution_note: str,
        payout_bps: int,
    ) -> None:
        """
        Only the bounty's designated arbiter may call this. An arbiter's
        decision bypasses the AI verification path entirely -- it exists
        specifically to handle cases the automated check got wrong.

        AUDIT-DRIVEN REDESIGN -- this does NOT move money. It records the
        arbiter's verdict and opens an `APPEAL_WINDOW_SECONDS` appeal
        window (`ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL`). Either party
        may `appeal_arbiter_resolution` before the window closes, escalating
        to a second, independent round of GenLayer validator consensus via
        `resolve_appeal` -- never a human's final call. If nobody
        appeals, anyone may permissionlessly call
        `finalize_arbiter_resolution` after the window closes to actually
        execute the payout. See ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL's
        docstring for why this two-step shape is what makes "appealable"
        real: once GEN has actually left the contract there is nothing
        left to appeal to, so a genuine appeal path requires holding the
        payout behind a window in the first place -- the previous version
        of this method paid out immediately and unconditionally on a bare
        arbiter say-so, exactly the "arbitrary override, no appeal"
        exposure this redesign closes.

        `verdict` is one of:
            "APPROVE" -- the pending resolution will pay the full reward
                         to this attempt once finalized. `payout_bps` is
                         ignored for this verdict.
            "PARTIAL" -- same as APPROVE but split per `payout_bps` (an
                         EXPLICIT basis-point integer, 1-9999, e.g. 6000
                         for a 60% challenger share) rounded onto the same
                         coarse 500-bps grid the AI-verdict path uses (see
                         `_bucket_payout_bps`). Deliberately an explicit
                         integer parameter rather than parsed out of the
                         free-text `resolution_note` -- an earlier version
                         of this method tried to extract a percentage from
                         arbitrary note text, which is exactly the kind of
                         ambiguous parsing that lets a human accidentally
                         authorize the wrong payout (e.g. a note reading
                         "60% credit... reviewed over 2 hours" naively
                         yields the digits "602", not the intended 60).
                         Financial amounts must never depend on freeform
                         text parsing; `resolution_note` is for human-
                         readable reasoning only and is never parsed here.
            "REJECT"  -- the pending resolution will forfeit this attempt's
                         bond to the creator once finalized. `payout_bps`
                         is ignored. REJECT is appealable too, symmetrically
                         with APPROVE/PARTIAL -- a wrongly-forfeited bond is
                         exactly as unfair as a wrongly-awarded reward.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)
        self._require_arbiter(bounty)

        if attempt.status != ATTEMPT_DISPUTED:
            raise gl.vm.UserError("Attempt is not currently under dispute")
        if verdict not in _VALID_ARBITER_VERDICTS:
            raise gl.vm.UserError(f"verdict must be one of {_VALID_ARBITER_VERDICTS}")
        if not resolution_note:
            raise gl.vm.UserError(
                "resolution_note must be non-empty -- every human ruling that can "
                "move money must be accompanied by an on-chain, readable justification, "
                "not a bare verdict code"
            )

        bucketed_bps = 0
        if verdict == ARBITER_PARTIAL:
            if payout_bps <= 0 or payout_bps >= BPS_DENOMINATOR:
                raise gl.vm.UserError(
                    "PARTIAL requires an explicit payout_bps strictly between 0 and "
                    f"{BPS_DENOMINATOR} (e.g. 6000 for a 60% challenger share)"
                )
            bucketed_bps = _bucket_payout_bps(payout_bps)

        # Record, BEFORE overwriting `last_verdict`'s role as the pending
        # comparison baseline, whether this ruling actually changes the
        # economic outcome AI consensus had already reached -- see
        # `_human_verdict_matches_ai_outcome` and `get_settlement_transparency`.
        attempt.human_verdict_overrode_ai = not _human_verdict_matches_ai_outcome(
            attempt.last_verdict, int(attempt.last_payout_bps), verdict, bucketed_bps
        )

        attempt.last_reasoning = _truncate(resolution_note, MAX_REASONING_LEN)
        attempt.status = u8(ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL)
        attempt.pending_arbiter_verdict = verdict
        attempt.pending_payout_bps = u256(bucketed_bps)
        attempt.appeal_deadline = u256(self._now() + APPEAL_WINDOW_SECONDS)

    @gl.public.write
    def finalize_arbiter_resolution(self, bounty_id: int, attempt_index: int) -> None:
        """
        Permissionless: executes an arbiter's pending resolution once its
        appeal window has closed with no appeal raised. Anyone may call
        this (the winning party has every incentive to), mirroring
        `request_verification`'s own permissionless-trigger design.

        If the bounty was independently settled by a DIFFERENT attempt
        while this one sat in its appeal window (a legitimate race, not an
        error), an APPROVE/PARTIAL resolution gracefully degrades to the
        same LOST_RACE-and-refund outcome `request_verification` uses in
        the equivalent situation, rather than reverting and leaving this
        attempt stuck with no valid path forward.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)

        if attempt.status != ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL:
            raise gl.vm.UserError("Attempt has no pending arbiter resolution to finalize")
        if self._now() < int(attempt.appeal_deadline):
            raise gl.vm.UserError("Appeal window has not closed yet")

        via_arbiter = True
        if attempt.pending_arbiter_verdict == ARBITER_REJECT:
            self._forfeit_attempt_bond(bounty, attempt, via_arbiter=via_arbiter)
            self._record_settlement_provenance(attempt, via_human_ruling=True)
            return

        if bounty.status != BOUNTY_OPEN:
            self._refund_attempt_bond(attempt, ATTEMPT_LOST_RACE)
            self._record_settlement_provenance(attempt, via_human_ruling=True)
            return

        self._settle_reward_to_winner(
            bounty, attempt, int(attempt.pending_payout_bps), via_arbiter=via_arbiter
        )
        self._mark_other_attempts_lost_race(bounty_id, attempt_index)
        self._record_settlement_provenance(attempt, via_human_ruling=True)

    @gl.public.write.payable
    def appeal_arbiter_resolution(self, bounty_id: int, attempt_index: int, reason: str) -> None:
        """
        Either the bounty's creator or the attempt's challenger may contest
        an arbiter's PENDING (not yet finalized) resolution before its
        appeal window closes, escalating the final call to a SECOND,
        independent round of GenLayer validator consensus via
        `resolve_appeal` -- not a human owner's personal judgment. Requires
        posting an appeal bond of EXACTLY the attempt's own `bond_amount`
        (reusing an amount already meaningful to this specific attempt
        rather than inventing a new protocol-wide constant) -- forfeited to
        the non-appealing party if that fresh consensus agrees with the
        arbiter (deterring frivolous appeals), returned in full to the
        appellant if it overturns the arbiter instead. See `resolve_appeal`.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)
        self._require_creator_or_challenger(bounty, attempt)

        if attempt.status != ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL:
            raise gl.vm.UserError("Attempt has no pending arbiter resolution to appeal")
        if self._now() >= int(attempt.appeal_deadline):
            raise gl.vm.UserError("Appeal window has already closed")
        if not reason:
            raise gl.vm.UserError("An appeal reason must be provided")

        sent = gl.message.value
        if int(sent) != int(attempt.bond_amount):
            raise gl.vm.UserError(
                "Appeal bond must exactly equal this attempt's bond_amount "
                f"(expected {int(attempt.bond_amount)}, got {int(sent)})"
            )

        attempt.status = u8(ATTEMPT_APPEALED)
        attempt.appealed_by = gl.message.sender_address
        attempt.appeal_reason = _truncate(reason, MAX_CRITERIA_LEN)
        attempt.appeal_bond_deposited = sent

    @gl.public.write
    def resolve_appeal(self, bounty_id: int, attempt_index: int) -> str:
        """
        Permissionless -- anyone may call this once an attempt is under
        appeal, mirroring `request_verification`'s own permissionless-
        trigger design. This is the final resolution tier for an appealed
        arbiter decision, and it is decided by a SECOND, independent round
        of GenLayer validator consensus (`_collect_appeal_verdict`), not by
        a human owner's personal judgment. No human ever makes the final,
        binding call on a disputed, not-yet-settled payout in this
        contract -- the only way a human ruling (the arbiter's) ever
        determines an outcome is if neither party chooses to exercise
        their available right to this fresh consensus review.

        The appeal bond posted in `appeal_arbiter_resolution` is returned
        to the appellant if this fresh consensus's economic conclusion
        DIFFERS from the arbiter's original pending verdict (the appeal
        succeeded), or forfeited to the non-appealing counterparty if it
        AGREES with the arbiter (the appeal failed) -- computed
        automatically by comparing verdicts/bucketed payouts via the same
        `_human_verdict_matches_ai_outcome` helper used to detect arbiter
        overrides elsewhere, never by a human declaring "uphold" or
        "overturn" themselves.

        If this fresh review itself can't reach a confident conclusion
        (`NEEDS_REVISION`/`INSUFFICIENT_EVIDENCE` -- e.g. the evidence page
        has since gone offline), the bond is refunded rather than
        forfeited and the appeal is treated as having succeeded (an
        arbiter's confident ruling that a second independent review can't
        confirm is not a ruling that should stand) -- there is no further
        resubmission cycle at this final stage.

        Returns the fresh consensus verdict string.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)

        if attempt.status != ATTEMPT_APPEALED:
            raise gl.vm.UserError("Attempt is not currently under appeal")

        # Copy every field the non-deterministic closure needs into plain
        # locals before calling into it -- storage-backed objects cannot be
        # read from inside a nondet block (same discipline as
        # `request_verification`).
        claim_text = bounty.claim_text
        criteria = bounty.proof_criteria
        evidence_requirements = bounty.evidence_requirements
        evidence_url = attempt.evidence_url
        pending_arbiter_verdict = attempt.pending_arbiter_verdict
        pending_payout_bps = int(attempt.pending_payout_bps)
        arbiter_reasoning = attempt.last_reasoning
        appeal_reason = attempt.appeal_reason

        verdict_info = self._collect_appeal_verdict(
            claim_text, criteria, evidence_requirements, evidence_url,
            pending_arbiter_verdict, arbiter_reasoning, appeal_reason,
        )
        verdict = verdict_info["verdict"]
        reasoning = verdict_info["reasoning"]
        payout_bps = verdict_info["payout_bps"]
        content_hash = verdict_info["content_hash"]

        # Does this fresh, independent consensus conclusion match what the
        # arbiter already ruled? If so the appeal FAILS (arbiter upheld);
        # if not, it SUCCEEDS (arbiter overturned by GenLayer consensus,
        # not by a human). Reuses the exact same comparison
        # `resolve_dispute` uses to detect AI-vs-human divergence --
        # here comparing the arbiter's ARBITER_* verdict against this
        # fresh AI-vocabulary verdict.
        arbiter_upheld = _human_verdict_matches_ai_outcome(
            verdict, payout_bps, pending_arbiter_verdict, pending_payout_bps
        )
        appeal_succeeded = not arbiter_upheld

        attempt.last_reasoning = reasoning
        attempt.pending_arbiter_verdict = verdict
        attempt.pending_payout_bps = u256(payout_bps if verdict == VERDICT_PARTIAL else 0)
        if content_hash:
            attempt.evidence_content_hash = content_hash
            attempt.evidence_fetched_at = u256(self._now())

        # --- read + zero the appeal-bond ledger BEFORE any transfer ---
        appeal_bond = attempt.appeal_bond_deposited
        appellant = attempt.appealed_by
        counterparty = bounty.creator if appellant == attempt.challenger else attempt.challenger
        attempt.appeal_bond_deposited = u256(0)

        # --- execute the final verdict, same zero-then-transfer primitives.
        # No human ruling is recorded here (`via_human_ruling=False`) --
        # this whole method's outcome was decided by GenLayer consensus. ---
        if verdict == VERDICT_REJECTED:
            self._forfeit_attempt_bond(bounty, attempt, via_arbiter=True)
        elif verdict in (VERDICT_NEEDS_REVISION, VERDICT_INSUFFICIENT_EVIDENCE):
            self._refund_attempt_bond(attempt, ATTEMPT_INSUFFICIENT_EVIDENCE_FINAL)
        elif bounty.status != BOUNTY_OPEN:
            self._refund_attempt_bond(attempt, ATTEMPT_LOST_RACE)
        else:
            effective_bps = payout_bps if verdict == VERDICT_PARTIAL else 0
            self._settle_reward_to_winner(bounty, attempt, effective_bps, via_arbiter=True)
            self._mark_other_attempts_lost_race(bounty_id, attempt_index)
        self._record_settlement_provenance(attempt, via_human_ruling=False)

        # --- appeal bond, strictly after everything else is settled ---
        if appeal_bond > 0:
            self._send_gen(appellant if appeal_succeeded else counterparty, appeal_bond)

        return verdict

    @gl.public.write
    def force_default_resolution(self, bounty_id: int, attempt_index: int) -> None:
        """
        The "stuck/abandoned" recovery exit for disputes. If an attempt is
        still DISPUTED once `bounty.deadline + ARBITER_GRACE_SECONDS` has
        passed with no arbiter action, either the creator or the challenger
        may force a safe default: the bond is refunded to the challenger
        (never forfeited by default -- an unresolved dispute is treated as
        "benefit of the doubt to whoever is still owed money," since the
        arbiter, not the challenger, is the party who failed to act) and,
        if the bounty is still OPEN, no reward payout occurs by default
        (a silent arbiter is not sufficient grounds to unilaterally award
        an unresolved claim). This guarantees funds can never be
        permanently locked purely because a named arbiter goes silent.
        """
        bounty = self._get_bounty(bounty_id)
        attempt = self._get_attempt(bounty_id, attempt_index)
        self._require_creator_or_challenger(bounty, attempt)

        if attempt.status != ATTEMPT_DISPUTED:
            raise gl.vm.UserError("Attempt is not currently under dispute")

        grace_deadline = int(bounty.deadline) + ARBITER_GRACE_SECONDS
        if self._now() < grace_deadline:
            raise gl.vm.UserError(
                "Arbiter grace period has not yet elapsed; only the arbiter "
                "may resolve this dispute right now"
            )

        self._refund_attempt_bond(attempt, ATTEMPT_CANCELLED)

    # ==================================================================
    # SECTION 10: PUBLIC ADMIN METHODS
    # ==================================================================

    @gl.public.write
    def update_default_fee_bps(self, new_fee_bps: int) -> None:
        self._require_owner()
        if new_fee_bps < 0 or new_fee_bps > MAX_FEE_BPS:
            raise gl.vm.UserError(f"new_fee_bps must be between 0 and {MAX_FEE_BPS}")
        self.default_fee_bps = u256(new_fee_bps)

    @gl.public.write
    def update_treasury(self, new_treasury_address: str) -> None:
        self._require_owner()
        new_treasury = Address(new_treasury_address)
        if new_treasury == self._zero_address():
            raise gl.vm.UserError("Treasury address must not be the zero address")
        self.treasury = new_treasury

    @gl.public.write
    def set_paused(self, paused: bool) -> None:
        self._require_owner()
        self.paused = paused

    @gl.public.write
    def transfer_ownership(self, new_owner_address: str) -> None:
        self._require_owner()
        new_owner = Address(new_owner_address)
        if new_owner == self._zero_address():
            raise gl.vm.UserError("New owner must not be the zero address")
        self.owner = new_owner

    # ==================================================================
    # SECTION 11: PUBLIC VIEW METHODS
    # ==================================================================

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def get_treasury(self) -> str:
        return self.treasury.as_hex

    @gl.public.view
    def get_default_fee_bps(self) -> int:
        return int(self.default_fee_bps)

    @gl.public.view
    def is_paused(self) -> bool:
        return self.paused

    @gl.public.view
    def get_bounty_counter(self) -> int:
        return int(self.bounty_counter)

    @gl.public.view
    def get_contract_balance(self) -> int:
        """Reads this contract's own native GEN balance via `self.balance`
        -- the `gl.Contract` base class's own balance property (backed by
        `wasi.get_self_balance()`; confirmed against the actual pinned SDK
        at `genlayer/gl/genvm_contracts.py`, NOT a top-level `gl.get_balance`
        / `gl.contract_address` API, which do not exist on this runner and
        previously made this method crash with an AttributeError). Useful
        for off-chain reconciliation against the sum of every bounty's
        `reward_deposited` and every attempt's `bond_deposited`."""
        return int(self.balance)

    @gl.public.view
    def get_bounty(self, bounty_id: int) -> dict:
        b = self._get_bounty(bounty_id)
        return {
            "bounty_id": int(b.bounty_id),
            "creator": b.creator.as_hex,
            "arbiter": b.arbiter.as_hex,
            "title": b.title,
            "claim_text": b.claim_text,
            "claim_polarity": b.claim_polarity,
            "category": b.category,
            "proof_criteria": b.proof_criteria,
            "evidence_requirements": b.evidence_requirements,
            "status": int(b.status),
            "status_label": BOUNTY_STATUS_LABELS.get(int(b.status), "UNKNOWN"),
            "reward_amount": int(b.reward_amount),
            "reward_deposited": int(b.reward_deposited),
            "required_bond": int(b.required_bond),
            "platform_fee_bps": int(b.platform_fee_bps),
            "attempt_count": int(b.attempt_count),
            "attempts_won": int(b.attempts_won),
            "winning_attempt_index": int(b.winning_attempt_index),
            "criteria_locked": b.criteria_locked,
            "deadline": int(b.deadline),
            "created_at": int(b.created_at),
        }

    @gl.public.view
    def get_attempt(self, bounty_id: int, attempt_index: int) -> dict:
        a = self._get_attempt(bounty_id, attempt_index)
        return {
            "bounty_id": int(a.bounty_id),
            "index": int(a.index),
            "challenger": a.challenger.as_hex,
            "bond_amount": int(a.bond_amount),
            "bond_deposited": int(a.bond_deposited),
            "status": int(a.status),
            "status_label": ATTEMPT_STATUS_LABELS.get(int(a.status), "UNKNOWN"),
            "evidence_url": a.evidence_url,
            "evidence_description": a.evidence_description,
            "revision_count": int(a.revision_count),
            "max_revisions": int(a.max_revisions),
            "last_verdict": a.last_verdict,
            "last_reasoning": a.last_reasoning,
            "last_payout_bps": int(a.last_payout_bps),
            "evidence_content_hash": a.evidence_content_hash,
            "evidence_fetched_at": int(a.evidence_fetched_at),
            "disputed_by": a.disputed_by.as_hex,
            "dispute_reason": a.dispute_reason,
            "pending_arbiter_verdict": a.pending_arbiter_verdict,
            "pending_payout_bps": int(a.pending_payout_bps),
            "appeal_deadline": int(a.appeal_deadline),
            "appealed_by": a.appealed_by.as_hex,
            "appeal_reason": a.appeal_reason,
            "appeal_bond_deposited": int(a.appeal_bond_deposited),
            "created_at": int(a.created_at),
            "submitted_at": int(a.submitted_at),
            "resolved_at": int(a.resolved_at),
            "resolved_by_arbiter": a.resolved_by_arbiter,
            "human_verdict_overrode_ai": a.human_verdict_overrode_ai,
        }

    @gl.public.view
    def get_settlement_transparency(self) -> dict:
        """
        Contract-wide, always-live evidence of how often an UNAPPEALED
        arbiter ruling actually changes an outcome AI consensus had
        already reached, versus how often AI consensus itself is what
        decided an attempt's fate -- and `resolve_appeal`'s own consensus
        resolutions count toward the AI side, not the human side, since
        appealing always escalates to a second independent GenLayer
        consensus round, never to a human's final word. See
        `attempts_settled_by_ai_consensus` / `attempts_settled_by_human_override`
        for exactly what each counter includes, and `Attempt.human_verdict_overrode_ai`
        for the per-attempt flag they're built from.

        `attempts_settled_by_human_override` can only ever be incremented
        by `finalize_arbiter_resolution` -- i.e. only when a diverging
        arbiter ruling went UNAPPEALED. This makes the real, remaining
        trust boundary precise: a human's word determines a payout only
        when both parties decline their available right to a fresh
        GenLayer consensus review, and exactly how often that happens is
        this queryable on-chain fact, not a claim anyone has to take on
        faith. It is structurally impossible for either counter to be
        affected by an attempt whose reward AI consensus already paid out
        (`ATTEMPT_WON` is excluded from `raise_dispute`'s live-state
        check, so a completed AI-driven payout can never retroactively
        become disputable at all).
        """
        ai = int(self.attempts_settled_by_ai_consensus)
        human = int(self.attempts_settled_by_human_override)
        total = ai + human
        override_rate_bps = (human * BPS_DENOMINATOR) // total if total > 0 else 0
        return {
            "attempts_settled_by_ai_consensus": ai,
            "attempts_settled_by_human_override": human,
            "total_settled_attempts": total,
            "human_override_rate_bps": override_rate_bps,
        }

    @gl.public.view
    def get_bounty_attempts(self, bounty_id: int) -> list[dict]:
        bounty = self._get_bounty(bounty_id)
        count = min(int(bounty.attempt_count), MAX_LISTING_SCAN)
        out: list[dict] = []
        for index in range(count):
            out.append(self.get_attempt(bounty_id, index))
        return out

    @gl.public.view
    def list_bounties(self, start_id: int, limit: int) -> list[dict]:
        """Paginated bounty listing. `limit` is clamped to
        `MAX_LISTING_SCAN` so a single view call can never be forced to
        scan an unbounded range as the protocol grows."""
        if start_id < 0:
            raise gl.vm.UserError("start_id must not be negative")
        bounded_limit = max(0, min(int(limit), MAX_LISTING_SCAN))
        total = int(self.bounty_counter)
        out: list[dict] = []
        current = int(start_id)
        while current < total and len(out) < bounded_limit:
            key = u256(current)
            if key in self.bounties:
                out.append(self.get_bounty(current))
            current += 1
        return out

    @gl.public.view
    def get_disputed_attempts(self, start_bounty_id: int, limit: int) -> list[dict]:
        """Bounded scan for every currently-DISPUTED attempt across a range
        of bounty ids -- intended for an off-chain indexer/dashboard to
        page through rather than for a single exhaustive on-chain call."""
        if start_bounty_id < 0:
            raise gl.vm.UserError("start_bounty_id must not be negative")
        bounded_limit = max(0, min(int(limit), MAX_LISTING_SCAN))
        total = int(self.bounty_counter)
        out: list[dict] = []
        bounty_id = int(start_bounty_id)
        while bounty_id < total and len(out) < bounded_limit:
            key = u256(bounty_id)
            if key in self.bounties:
                bounty = self.bounties[key]
                for index in range(min(int(bounty.attempt_count), MAX_LISTING_SCAN)):
                    attempt = self.attempts[self._attempt_key(bounty_id, index)]
                    if int(attempt.status) == ATTEMPT_DISPUTED:
                        out.append(self.get_attempt(bounty_id, index))
                        if len(out) >= bounded_limit:
                            break
            bounty_id += 1
        return out

    @gl.public.view
    def get_reputation(self, address: str) -> dict:
        addr = Address(address)
        if addr not in self.reputation:
            return {
                "address": addr.as_hex,
                "bounties_created": 0,
                "bounties_funded_total": 0,
                "attempts_made": 0,
                "attempts_won": 0,
                "attempts_partial": 0,
                "attempts_rejected": 0,
                "attempts_disputed": 0,
                "total_earned": 0,
            }
        r = self.reputation[addr]
        return {
            "address": addr.as_hex,
            "bounties_created": int(r.bounties_created),
            "bounties_funded_total": int(r.bounties_funded_total),
            "attempts_made": int(r.attempts_made),
            "attempts_won": int(r.attempts_won),
            "attempts_partial": int(r.attempts_partial),
            "attempts_rejected": int(r.attempts_rejected),
            "attempts_disputed": int(r.attempts_disputed),
            "total_earned": int(r.total_earned),
        }

    @gl.public.view
    def get_valid_categories(self) -> list[str]:
        return list(VALID_CATEGORIES)