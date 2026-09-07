# Review response: fixes and verification

This document maps each item raised in the team's review directly to the
code change that addresses it, the regression test that proves it, and
the live on-chain confirmation that it actually works.

All three items were confirmed as real, reproducible issues — not false
alarms — and are fixed, tested, and now live on the 10th deployment
(`0x9EAe7903e7489478C53a48Ab06D57d5aFb3eE3F1`).

## What the review asked for

> Before this can be accepted, keep the reward locked while any dispute
> or appeal can still resolve, preserve the appeal bond as an exact
> integer, and show the timeout action only after the contract's grace
> period. Please add focused regression tests proving all three paths.

---

## 1. Keep the reward locked while any dispute or appeal can still resolve

**The problem.** `claim_creator_timeout` let a bounty's creator reclaim
an expired, unsettled reward once `deadline + VERIFICATION_GRACE_SECONDS`
(24 hours) had passed — but it only checked that the bounty itself was
still `OPEN`. Raising a dispute, an arbiter ruling, or an appeal never
touch the bounty's own status field, so a reward could be reclaimed
while a dispute was still actively working its way through the
arbiter/appeal tier — even though a fresh ruling might still be about to
award that same reward to the disputing challenger. The 2-day appeal
window alone can outlast the 24-hour grace buffer, so this was a real,
reachable race, not a theoretical edge case.

**The fix.** [contracts/proof_bounty.py](contracts/proof_bounty.py) —
added an explicit whitelist, `_ATTEMPT_DISPUTE_IN_PROGRESS_STATES`
(`DISPUTED`, `ARBITER_RESOLVED_PENDING_APPEAL`, `APPEALED`).
`claim_creator_timeout` now scans the bounty's attempts (bounded to
`MAX_ATTEMPTS_PER_BOUNTY`, the same pattern already used elsewhere) and
rejects the claim if any attempt is still in one of those states.

**Regression test.**
`test_claim_creator_timeout_rejects_while_dispute_is_still_resolving`
in [tests/integration/test_proof_bounty.py](tests/integration/test_proof_bounty.py)
— two-part proof, run via `gltest.direct` with real elapsed-time
control:
1. While an attempt sits in `ARBITER_RESOLVED_PENDING_APPEAL`, the claim
   is rejected even though deadline + grace has long passed.
2. Once that same dispute genuinely resolves to an outcome that leaves
   the bounty with no winner, the claim then succeeds — proving the fix
   blocks exactly the in-flight window, not the reward permanently.

**Live confirmation.** Exercised as part of the normal product-test
flow across the 9th and 10th deployments (disputes that reach
`ARBITER_RESOLVED_PENDING_APPEAL`/`APPEALED` and later settle) — the
bounty's reward stayed correctly locked throughout each dispute's
lifecycle on real StudioNet infrastructure.

---

## 2. Preserve the appeal bond as an exact integer

**The problem.** The frontend's `appeal_arbiter_resolution` call
constructed its transaction value via
`toGenWei(String(Number(attempt.bond_amount) / 1e18))` — round-tripping
an already-exact wei integer through a JavaScript `Number`. Every real
bond amount exceeds `Number.MAX_SAFE_INTEGER` (2^53 − 1), so this could
silently drift by a few wei. Since the contract requires the posted bond
to *exactly* equal `attempt.bond_amount` (deliberately, so the amount is
never ambiguous), even a 1-wei drift would make a legitimate appeal
revert on-chain.

**The fix.**
[apps/web/components/bounty/AttemptCard.tsx](apps/web/components/bounty/AttemptCard.tsx) —
changed to `BigInt(attempt.bond_amount)` directly, matching how
`accept_bounty`'s bond value is already constructed elsewhere in the app
(`apps/web/app/bounty/[id]/page.tsx`). No lossy conversion, no
round-trip.

**Regression tests.**
- `test_appeal_bond_is_preserved_as_an_exact_integer` in
  [tests/integration/test_proof_bounty.py](tests/integration/test_proof_bounty.py)
  — uses a deliberately non-round bond amount
  (`234_567_891_234_567_891` wei), asserts a 1-wei-short and a 1-wei-over
  bond are both rejected, and that the exact amount is accepted and
  stored back unchanged. **Ran live against real StudioNet — passed.**
- [scripts/14-regression-appeal-bond-and-timeout.mjs](scripts/14-regression-appeal-bond-and-timeout.mjs)
  — imports the real frontend `format.ts` functions directly (not a
  reimplementation) and demonstrates the old construction actually
  drifts (`234567891234567891` → `234567891234567900`, a real 9-wei
  error) while the new one is exact.

**Live confirmation.** Every appeal posted during the 9th and 10th
product-test rounds (real bond amounts, real StudioNet transactions)
succeeded on the first attempt with the corrected frontend logic.

---

## 3. Show the timeout action only after the contract's grace period

**The problem.** The "Claim Timeout Refund" button
(`apps/web/app/bounty/[id]/page.tsx`) appeared as soon as a bounty's
deadline passed (`isExpired(bounty.deadline)`), without also requiring
the contract's own `VERIFICATION_GRACE_SECONDS` (24-hour) buffer past
it. A creator could see and click the button a full day before the
contract would actually accept the call, and the transaction would
revert.

**The fix.** Added a `VERIFICATION_GRACE_SECONDS` constant to
[apps/web/lib/format.ts](apps/web/lib/format.ts) (documented as needing
to stay in sync with the contract's own constant), and gated
`canClaimTimeout` on `now >= bounty.deadline + VERIFICATION_GRACE_SECONDS`
using the existing `useNow()` hook rather than deadline alone.

**Regression test.**
[scripts/14-regression-appeal-bond-and-timeout.mjs](scripts/14-regression-appeal-bond-and-timeout.mjs)
— boundary-tests the button's visibility logic to the second: hidden
before the deadline, hidden immediately after the deadline (grace not
yet elapsed), hidden right up to the grace deadline, correctly shown
once the grace period has actually passed.

---

## Follow-up audit: the button still stayed visible during a live dispute

A second review pass on this fix caught a real remaining gap: past the
grace period, the "Claim Timeout Refund" button still displayed even
when an attempt on the bounty was `DISPUTED`, `ARBITER_RESOLVED_PENDING_APPEAL`,
or `APPEALED`. The contract correctly rejected that click (the fix
above), but the UI was still offering an action guaranteed to revert.
The same pass also noted the regression script mostly reimplemented the
UI's predicates rather than testing the actual rendered logic — a fair
distinction, since a reimplementation can pass while the real component
stays broken.

**The fix.** Extracted the button's full visibility logic into a single,
standalone, exported function,
[`canClaimBountyTimeout`](apps/web/lib/bounty-actions.ts), mirroring the
contract's `_ATTEMPT_DISPUTE_IN_PROGRESS_STATES` check — the same three
in-flight statuses, checked against the bounty's live attempts.
`bounty/[id]/page.tsx` now calls this function directly instead of
inlining the (incomplete) condition itself.

**Regression test, now against the real function, not a copy of it.**
`scripts/14-regression-appeal-bond-and-timeout.mjs` was rewritten to
*import* `canClaimBountyTimeout` from its real source file and call it
directly, for both the grace-period boundary checks and three new
assertions proving the button stays hidden while any attempt is in each
of the three in-progress states, and is correctly shown again once none
are. (`apps/web/tsconfig.json` gained `allowImportingTsExtensions` —
the standard, documented flag for exactly this `noEmit` + `moduleResolution:
"bundler"` setup — so the same source file resolves cleanly under both
Next.js's compiler and a plain Node run of the regression script.)
Verified with `tsc --noEmit`, `eslint`, and a full `next build`, all
clean.

---

## Second follow-up audit: a loading-state gap in the same fix

A third review pass caught a real, more subtle gap in the fix above:
`bounty/[id]/page.tsx` called `canClaimBountyTimeout` with
`attempts: attempts ?? []`. While `get_bounty_attempts` is still
loading, `useContractRead`'s `data` starts out `null` — so that
defaulting treated the genuinely UNKNOWN attempt list the same as a
CONFIRMED-empty one. Past the grace period, this meant the timeout
button could briefly render even when a real dispute existed but simply
hadn't finished loading yet — the contract would still correctly reject
the click, but the UI shouldn't offer it in the first place. The
existing regression test didn't cover this loading-state path.

**The fix.** Moved the loading-awareness into `canClaimBountyTimeout`
itself rather than relying on every future caller to remember a separate
`attempts !== undefined` guard: it now accepts `attempts` as possibly
`null` or `undefined` and returns `false` immediately whenever the list
hasn't actually arrived yet. `bounty/[id]/page.tsx` now passes
`attempts` straight through instead of defaulting it to `[]`.

**Regression test.** Added to
`scripts/14-regression-appeal-bond-and-timeout.mjs`: asserts the button
stays hidden for both `attempts: undefined` and `attempts: null` (the
real value `useContractRead` uses while loading) even past the grace
period with no dispute data at all, and a sanity check that a genuinely
loaded, empty attempt list still correctly shows the button. Confirmed
this test actually catches the bug by temporarily reverting the fix and
re-running it (it failed, as expected, with a `TypeError` from calling
`.some()` on `undefined` — the pre-fix code didn't even guard against
that). Verified again with `tsc --noEmit`, `eslint`, and a full
`next build`, all clean.

---

## Verification summary

| Check | Result |
|---|---|
| `genvm-lint check contracts/proof_bounty.py` | Clean — 33 methods, unchanged shape |
| Offline `gltest.direct` test suite | All passing |
| `test_appeal_bond_is_preserved_as_an_exact_integer` | Passing, **run live against real StudioNet** |
| Frontend `tsc --noEmit` / `eslint` / `next build` | Clean |
| `scripts/14-regression-appeal-bond-and-timeout.mjs` (imports the real UI predicate functions, not reimplementations) | Passing |
| Deployed bytecode vs. source (`genlayer code` diff) | Byte-for-byte match, confirmed on the 9th and 10th deployments |
| Full 4-test live product round, 9th and 10th deployments | Zero unresolved errors on the explorer |

## A related issue found and fixed during live testing (not originally flagged by the team)

While running the product-test round on the 9th deployment, a
challenger's on-chain reputation read `attempts_rejected: 2` for a
single rejected attempt, with zero retries or transient errors involved
— ruling out a testing artifact. Root cause: `request_verification`
charges an `attempts_rejected` reputation strike the moment an attempt
first reaches `REJECTED_FINAL`, but `_forfeit_attempt_bond` (called by
`claim_bond_forfeiture`, and shared by the dispute/appeal tier) also
unconditionally charged the same strike again for the same attempt —
double-counting the single most common rejection path in the contract.

Fixed with a new `Attempt.rejection_counted` guard flag, checked at all
three increment sites so a given attempt can only ever be charged once.
Regression test
`test_attempts_rejected_is_not_double_counted_across_reject_then_forfeit`
was confirmed to genuinely catch the bug (temporarily reverting the fix
made the test fail as expected). Confirmed correct live on the 10th
deployment in both scenarios the fix covers — a direct rejection later
forfeited, and a dispute/appeal that resolves to rejected.
