"""
Integration tests for contracts/proof_bounty.py.

Run with GenLayer's `gltest` runner (from the project root, against
StudioNet -- this suite has no `gltest.config.yaml`, so the network must
be passed explicitly or it silently defaults to `localnet`):

    gltest tests/integration -v -s --network studionet --chain-type studionet

Audit-driven fix (2026-08-26): this suite was written against an older
`genlayer-test` fixture API (`setup_validators`) that no longer exists in
the currently installed CLI (genlayer-test 0.29.2) -- every test in this
file was silently erroring at fixture setup ("fixture 'setup_validators'
not found") and had not actually been run since. `get_contract_factory`'s
signature also changed (exactly one of `contract_name`/`contract_file_path`,
and the path is resolved relative to the configured contracts directory,
not the repo root). Fixed by dropping the fixture entirely (the `accounts`
fixture alone is sufficient against a live network) and adjusting
`_factory()`/`_deploy()` accordingly -- confirmed by actually running the
full suite against StudioNet, not just re-reading the diff.

API pattern (get_contract_factory / .transact(value=...) / .call() /
tx_execution_succeeded) mirrors this project's own previously-verified
`ic/tests/test_deliverable_escrow.py`, itself checked directly against
GenLayer's maintained reference test suites.

Coverage map:
  * Deployment & constructor validation      -> test_deploy_*
  * Bounty creation & exact-value escrow      -> test_create_bounty_*
  * Attempt lifecycle & bond escrow           -> test_accept_bounty_*
  * Access control                            -> test_*_wrong_caller
  * Criteria immutability post-lock           -> test_criteria_locked_*
  * Cancellation / timeout recovery           -> test_cancel_bounty_*, test_claim_creator_timeout_*
  * Admin surface (owner-only, non-custodial) -> test_admin_*
  * The non-deterministic AI verification     -> test_request_verification_* (network/LLM required)
"""

import time

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus

CONTRACT_PATH = "proof_bounty.py"  # resolved relative to the configured contracts dir

ONE_HOUR = 3600
ONE_DAY = 24 * 3600
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

VALID_CRITERIA = "1. The page must state X.\n2. The page must show Y."
VALID_EVIDENCE_REQS = "A public URL demonstrating the claim."


def _factory():
    return get_contract_factory(contract_file_path=CONTRACT_PATH)


def _deploy(treasury_address, fee_bps=250):
    factory = _factory()
    return factory.deploy(args=[treasury_address, fee_bps])


def _create_bounty(
    contract,
    arbiter,
    reward=10 * 10**18,
    bond=0,
    deadline=ONE_DAY,
    polarity="POSITIVE",
    category="OPEN_SOURCE",
):
    return contract.create_bounty(
        args=[
            "Prove the docs contradiction",
            "The docs at X claim Y but the code does Z.",
            polarity,
            category,
            VALID_CRITERIA,
            VALID_EVIDENCE_REQS,
            arbiter,
            deadline,
            bond,
        ]
    ).transact(value=reward, wait_transaction_status=TransactionStatus.FINALIZED)


# ============================================================================
# Deployment / constructor
# ============================================================================


def test_deploy_and_schema_smoke(accounts):
    """Cheapest possible 'did this deploy with a valid, loadable schema'
    check -- touches only two constants and an empty counter."""
    treasury = accounts[1].address
    contract = _deploy(treasury, fee_bps=250)

    assert contract.get_bounty_counter(args=[]).call() == 0
    assert contract.get_contract_balance(args=[]).call() == 0
    assert contract.is_paused(args=[]).call() is False
    categories = contract.get_valid_categories(args=[]).call()
    assert "SECURITY" in categories and "OPEN_SOURCE" in categories


def test_deploy_rejects_fee_above_max(accounts):
    # Audit-driven fix: the currently installed gltest raises
    # DeploymentError directly when the deploy transaction's constructor
    # reverts, rather than returning a receipt for tx_execution_succeeded
    # to inspect (an older API assumption this suite previously made
    # everywhere, silently untested since -- see module docstring).
    factory = _factory()
    treasury = accounts[1].address
    with pytest.raises(Exception):
        factory.deploy(args=[treasury, 1001])  # MAX_FEE_BPS == 1000


# ============================================================================
# create_bounty
# ============================================================================


def test_create_bounty_success(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)

    tx = _create_bounty(contract, arbiter)
    assert tx_execution_succeeded(tx)
    assert contract.get_bounty_counter(args=[]).call() == 1

    bounty = contract.get_bounty(args=[0]).call()
    assert bounty["status_label"] == "OPEN"
    assert bounty["arbiter"].lower() == arbiter.lower()
    assert bounty["reward_deposited"] == 10 * 10**18
    assert bounty["criteria_locked"] is False
    assert bounty["attempt_count"] == 0


def test_create_bounty_rejects_zero_address_arbiter(accounts):
    treasury = accounts[1].address
    contract = _deploy(treasury)
    tx = _create_bounty(contract, ZERO_ADDRESS)
    assert not tx_execution_succeeded(tx)


def test_create_bounty_rejects_short_deadline(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)
    tx = _create_bounty(contract, arbiter, deadline=60)  # below MIN_BOUNTY_DEADLINE_SECONDS
    assert not tx_execution_succeeded(tx)


def test_create_bounty_rejects_zero_reward(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)
    tx = _create_bounty(contract, arbiter, reward=0)
    assert not tx_execution_succeeded(tx)


def test_create_bounty_rejects_invalid_category(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)
    tx = contract.create_bounty(
        args=[
            "Title", "Claim", "POSITIVE", "NOT_A_REAL_CATEGORY",
            VALID_CRITERIA, VALID_EVIDENCE_REQS, arbiter, ONE_DAY, 0,
        ]
    ).transact(value=10 * 10**18, wait_transaction_status=TransactionStatus.FINALIZED)
    assert not tx_execution_succeeded(tx)


# ============================================================================
# accept_bounty / attempt lifecycle
# ============================================================================


def test_accept_bounty_locks_criteria_and_bond(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=1 * 10**18)

    tx = contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=1 * 10**18, wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert tx_execution_succeeded(tx)

    bounty = contract.get_bounty(args=[0]).call()
    assert bounty["criteria_locked"] is True
    assert bounty["attempt_count"] == 1

    attempt = contract.get_attempt(args=[0, 0]).call()
    assert attempt["status_label"] == "ACCEPTED"
    assert attempt["bond_deposited"] == 1 * 10**18
    assert attempt["challenger"].lower() == challenger.address.lower()


def test_accept_bounty_rejects_wrong_bond_amount(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=1 * 10**18)

    tx = contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=500000000000000000,  # 0.5 GEN, not the required 1 GEN
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert not tx_execution_succeeded(tx)


def test_accept_bounty_rejects_creator_self_attempt(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)

    tx = contract.accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


def test_multiple_concurrent_attempts_allowed(accounts):
    """Core marketplace guarantee: several challengers may hold concurrent
    open attempts on the same OPEN bounty."""
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger_a, challenger_b = accounts[3], accounts[4]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)

    tx_a = contract.connect(challenger_a).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    tx_b = contract.connect(challenger_b).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert tx_execution_succeeded(tx_a)
    assert tx_execution_succeeded(tx_b)

    bounty = contract.get_bounty(args=[0]).call()
    assert bounty["attempt_count"] == 2


# ============================================================================
# submit_evidence validation
# ============================================================================


def test_submit_evidence_rejects_non_http_url(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(challenger).submit_evidence(
        args=[0, 0, "ftp://not-http.example", "desc"]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert not tx_execution_succeeded(tx)


def test_submit_evidence_rejects_wrong_caller(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    stranger = accounts[4]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(stranger).submit_evidence(
        args=[0, 0, "https://example.com/evidence", "desc"]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert not tx_execution_succeeded(tx)


# ============================================================================
# cancel_bounty / timeout recovery
# ============================================================================


def test_cancel_bounty_before_any_attempt_refunds_creator(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, reward=5 * 10**18)

    tx = contract.cancel_bounty(args=[0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert tx_execution_succeeded(tx)

    bounty = contract.get_bounty(args=[0]).call()
    assert bounty["status_label"] == "CANCELLED"
    assert bounty["reward_deposited"] == 0


def test_cancel_bounty_rejects_after_criteria_locked(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.cancel_bounty(args=[0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


def test_claim_creator_timeout_rejects_before_deadline(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, deadline=ONE_DAY)

    tx = contract.claim_creator_timeout(args=[0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


def test_claim_creator_timeout_rejects_wrong_caller(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    stranger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, deadline=ONE_HOUR)

    tx = contract.connect(stranger).claim_creator_timeout(args=[0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


# ============================================================================
# Disputes
# ============================================================================


def test_raise_dispute_rejects_empty_reason(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(challenger).raise_dispute(args=[0, 0, ""]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


def test_resolve_dispute_rejects_non_arbiter(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    stranger = accounts[4]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).raise_dispute(args=[0, 0, "AI verdict was wrong"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(stranger).resolve_dispute(
        args=[0, 0, "APPROVE", "not the arbiter"]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert not tx_execution_succeeded(tx)


def test_force_default_resolution_rejects_before_grace_period(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0, deadline=ONE_HOUR)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).raise_dispute(args=[0, 0, "AI verdict was wrong"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(challenger).force_default_resolution(args=[0, 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


# ============================================================================
# Admin surface
# ============================================================================


def test_admin_update_fee_rejects_non_owner(accounts):
    treasury = accounts[1].address
    stranger = accounts[2]
    contract = _deploy(treasury)

    tx = contract.connect(stranger).update_default_fee_bps(args=[500]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


def test_admin_set_paused_blocks_create_bounty(accounts):
    treasury = accounts[1].address
    arbiter = accounts[2].address
    contract = _deploy(treasury)

    tx = contract.set_paused(args=[True]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert tx_execution_succeeded(tx)

    tx2 = _create_bounty(contract, arbiter)
    assert not tx_execution_succeeded(tx2)


# ============================================================================
# End-to-end happy path with real web fetch + real multi-validator LLM
# consensus. Requires a network/validator set capable of nondet execution
# (StudioNet or a locally running GenLayer Studio node with LLM providers
# configured) -- mark separately so the rest of the suite runs offline.
# ============================================================================


@pytest.mark.llm
def test_request_verification_full_lifecycle(accounts):
    """
    Full happy path against a real, publicly reachable evidence URL. This
    is intentionally the ONLY test in this file that depends on live web
    fetch + live LLM consensus -- everything else is validated without it
    so the fast majority of this suite can run in any environment.
    """
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)

    _create_bounty(
        contract,
        arbiter,
        reward=1 * 10**18,
        bond=0,
        category="DOCUMENTATION",
    )
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).submit_evidence(
        args=[0, 0, "https://docs.genlayer.com/", "GenLayer's own documentation homepage"]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)

    tx = contract.request_verification(args=[0, 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert tx_execution_succeeded(tx)

    attempt = contract.get_attempt(args=[0, 0]).call()
    assert attempt["last_verdict"] in ("APPROVED", "PARTIAL", "REJECTED", "NEEDS_REVISION", "INSUFFICIENT_EVIDENCE")


# ============================================================================
# Audit-driven economic paths -- previously only exercised by manual scripts
# (scripts/08-attempt-cap-and-zero-bond.mjs, scripts/09-appeal-flow.mjs)
# against live StudioNet. These cover the SAME state-machine transitions as
# real `gltest` assertions instead, and run offline like the rest of the
# suite: `raise_dispute`/`resolve_dispute`/`appeal_arbiter_resolution`/
# `finalize_arbiter_resolution` never touch `gl.nondet.*`, so the dispute ->
# pending-appeal -> appeal-posted chain can be driven with no live web
# fetch or LLM call involved. `resolve_appeal` itself now DOES touch
# `gl.nondet.*` (a second, independent GenLayer consensus round replacing
# what used to be an owner's personal judgment call -- see that method's
# docstring) and is therefore only exercised live, marked `@pytest.mark.llm`,
# not in this offline block.
# ============================================================================


def test_max_attempts_per_bounty_cap_enforced(accounts):
    """The audit's #1 critical finding: a settlement-DoS via unbounded
    concurrent attempts. Real 41 accept_bounty transactions -- the cap
    (40) must be enforced exactly, not off-by-one in either direction."""
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)

    # GenLayer's real StudioNet RPC rate limit is 30 requests/minute --
    # 41 back-to-back transactions in this one test would exceed it on
    # its own (confirmed live: an earlier unpaced run hit "Rate limit
    # exceeded: 30 requests per minute" partway through). 2.1s/call keeps
    # 41 calls under the 30/min ceiling with margin.
    RATE_LIMIT_PACING_SECONDS = 2.1

    # Waiting for ACCEPTED (not FINALIZED) for each of the 40 loop
    # iterations: FINALIZED requires an extra, slower polling round for
    # the finalization consensus step, which more than doubles this
    # test's already-long wall-clock time and was observed live to hit
    # GenLayer's real infrastructure returning a transient 502 mid-poll
    # (twice, on two separate runs) purely from being in flight longer --
    # not a contract or test bug. ACCEPTED still means real validator
    # consensus was reached on-chain; only the very last (over-the-cap)
    # transaction below waits for FINALIZED, since that one specifically
    # needs a fully settled execution_result to assert against.
    for i in range(40):
        time.sleep(RATE_LIMIT_PACING_SECONDS)
        tx = contract.connect(challenger).accept_bounty(args=[0]).transact(
            value=0, wait_transaction_status=TransactionStatus.ACCEPTED
        )
        assert tx_execution_succeeded(tx), f"attempt {i + 1}/40 should be under the cap"

    bounty = contract.get_bounty(args=[0]).call()
    assert bounty["attempt_count"] == 40

    tx_over_cap = contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx_over_cap), "the 41st attempt must be rejected by MAX_ATTEMPTS_PER_BOUNTY"


def test_zero_bond_reclaim_after_settlement_rejects_before_appeal_window(accounts):
    """Live-network half of the zero-bond LOST_RACE coverage: the arbiter
    APPROVEs attempt 0 directly (no LLM), opening the pending-appeal
    window, and `finalize_arbiter_resolution` must reject before that
    window closes. The full positive path (finalize succeeding, attempt 1
    actually reaching LOST_RACE, and reclaiming its zero bond actually
    succeeding) needs real elapsed time this harness can't wait out live
    -- see `test_zero_bond_reclaim_after_settlement_is_a_safe_noop` below,
    which proves that exact path deterministically via `gltest.direct`'s
    time-warp cheatcode instead."""
    treasury = accounts[1].address
    arbiter_account = accounts[2]
    arbiter = arbiter_account.address
    challenger_a, challenger_b = accounts[3], accounts[4]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0, deadline=ONE_HOUR)

    contract.connect(challenger_a).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger_b).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )

    contract.connect(challenger_a).raise_dispute(args=[0, 0, "Escalating to arbiter directly"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    tx_resolve = contract.connect(arbiter_account).resolve_dispute(
        args=[0, 0, "APPROVE", "Arbiter approves attempt 0 directly", 0]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(tx_resolve)

    attempt0 = contract.get_attempt(args=[0, 0]).call()
    assert attempt0["status_label"] == "ARBITER_RESOLVED_PENDING_APPEAL"
    assert attempt0["pending_arbiter_verdict"] == "APPROVE"

    tx_too_early = contract.finalize_arbiter_resolution(args=[0, 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx_too_early), "finalize must reject before appeal_deadline"


def test_zero_bond_reclaim_after_settlement_is_a_safe_noop(direct_vm, direct_deploy, direct_accounts):
    """Audit-flagged bug, full positive path: a zero-bond LOST_RACE
    attempt used to revert forever on reclaim_bond_after_settlement
    ('Bond has already been reclaimed') even on a legitimate first call,
    stranding the STATE (never funds, since none were owed).

    Reaching this requires real elapsed time past `APPEAL_WINDOW_SECONDS`
    (2 days), which isn't practical to wait out against live StudioNet --
    this uses `gltest.direct`'s native Python test runner instead, which
    lets the contract's own `_now()` be advanced directly. Verified
    empirically first (not assumed) that `VMContext.warp()` does NOT
    actually reach this contract's `_now()`, since it reads
    `gl.message_raw["datetime"]` directly rather than `datetime.now()`
    (see contracts/proof_bounty.py's `_now`) -- so `gl.message_raw` is
    patched directly instead, which a throwaway probe confirmed works.

    Full path: arbiter APPROVEs attempt 0 -> ARBITER_RESOLVED_PENDING_APPEAL
    -> (time warp past appeal_deadline) -> finalize_arbiter_resolution
    actually pays out attempt 0 (WON) and marks attempt 1 LOST_RACE ->
    reclaiming attempt 1's zero bond actually succeeds as a no-op.
    """
    import sys
    import datetime as dt

    treasury = direct_accounts[1]
    arbiter = direct_accounts[2]
    challenger_a = direct_accounts[3]
    challenger_b = direct_accounts[4]
    contract = direct_deploy("proof_bounty.py", treasury, 250)

    direct_vm.value = 10 * 10**18
    contract.create_bounty(
        "Prove the docs contradiction", "The docs at X claim Y but the code does Z.",
        "POSITIVE", "OPEN_SOURCE", VALID_CRITERIA, VALID_EVIDENCE_REQS, arbiter, ONE_HOUR, 0,
    )
    direct_vm.value = 0

    with direct_vm.prank(challenger_a):
        contract.accept_bounty(0)
    with direct_vm.prank(challenger_b):
        contract.accept_bounty(0)

    with direct_vm.prank(challenger_a):
        contract.raise_dispute(0, 0, "Escalating to arbiter directly")
    with direct_vm.prank(arbiter):
        contract.resolve_dispute(0, 0, "APPROVE", "Arbiter approves attempt 0 directly", 0)

    attempt0 = contract.get_attempt(0, 0)
    assert attempt0["status_label"] == "ARBITER_RESOLVED_PENDING_APPEAL"
    assert attempt0["pending_arbiter_verdict"] == "APPROVE"

    # Advance past the 2-day appeal window (+ buffer) by patching the
    # message's own recorded datetime -- see docstring above for why
    # `direct_vm.warp()` alone does not do this for THIS contract.
    gl = sys.modules["genlayer.gl"]
    future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=3)
    gl.message_raw["datetime"] = future.isoformat().replace("+00:00", "Z")

    contract.finalize_arbiter_resolution(0, 0)

    attempt0_final = contract.get_attempt(0, 0)
    assert attempt0_final["status_label"] == "WON", "attempt 0 actually settled after the appeal window closed"

    attempt1_final = contract.get_attempt(0, 1)
    assert attempt1_final["status_label"] == "LOST_RACE", "attempt 1 auto-marked LOST_RACE by the real settlement"
    assert attempt1_final["bond_deposited"] == 0, "zero-bond bounty -- nothing was ever actually held"

    # The actual audit-flagged bug: this used to revert unconditionally
    # whenever bond_deposited <= 0. Must now succeed as a real no-op.
    with direct_vm.prank(challenger_b):
        contract.reclaim_bond_after_settlement(0, 1)

    attempt1_after_reclaim = contract.get_attempt(0, 1)
    assert attempt1_after_reclaim["status_label"] == "LOST_RACE", "reclaim is a status no-op, not a state transition"


def test_appeal_arbiter_resolution_rejects_wrong_bond_amount(accounts):
    treasury = accounts[1].address
    arbiter_account = accounts[2]
    arbiter = arbiter_account.address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).raise_dispute(args=[0, 0, "Disputing directly"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(arbiter_account).resolve_dispute(args=[0, 0, "REJECT", "Arbiter rejects", 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )

    # attempt.bond_amount is 0 (zero-bond bounty) -- posting ANY nonzero
    # appeal bond must be rejected since it must exactly equal bond_amount.
    tx = contract.appeal_arbiter_resolution(args=[0, 0, "I disagree with this ruling"]).transact(
        value=1 * 10**18, wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx)


def test_appeal_arbiter_resolution_rejects_stranger(accounts):
    treasury = accounts[1].address
    arbiter_account = accounts[2]
    arbiter = arbiter_account.address
    challenger = accounts[3]
    stranger = accounts[4]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).raise_dispute(args=[0, 0, "Disputing directly"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(arbiter_account).resolve_dispute(args=[0, 0, "REJECT", "Arbiter rejects", 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(stranger).appeal_arbiter_resolution(
        args=[0, 0, "I have no standing here"]
    ).transact(value=0, wait_transaction_status=TransactionStatus.FINALIZED)
    assert not tx_execution_succeeded(tx)


def test_appeal_arbiter_resolution_success_reaches_appealed_status(accounts):
    """The real, positive appeal path: creator posts the exact required
    bond and the attempt correctly reaches APPEALED with appeal metadata
    recorded, all before any money moves (the core of the two-tier
    redesign)."""
    treasury = accounts[1].address
    arbiter_account = accounts[2]
    arbiter = arbiter_account.address
    challenger = accounts[3]
    creator = accounts[0]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=1 * 10**18)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=1 * 10**18, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).raise_dispute(args=[0, 0, "Disputing directly"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(arbiter_account).resolve_dispute(args=[0, 0, "REJECT", "Arbiter rejects", 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(creator).appeal_arbiter_resolution(
        args=[0, 0, "The arbiter's ruling does not match the actual evidence submitted"]
    ).transact(value=1 * 10**18, wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(tx)

    attempt = contract.get_attempt(args=[0, 0]).call()
    assert attempt["status_label"] == "APPEALED"
    assert attempt["appealed_by"].lower() == creator.address.lower()
    assert attempt["appeal_bond_deposited"] == 1 * 10**18

    # Double-appeal must fail -- no longer in the appealable status.
    tx_double = contract.connect(challenger).appeal_arbiter_resolution(
        args=[0, 0, "Also appealing"]
    ).transact(value=1 * 10**18, wait_transaction_status=TransactionStatus.FINALIZED)
    assert not tx_execution_succeeded(tx_double)


def test_resolve_appeal_rejects_when_not_appealed(accounts):
    """`resolve_appeal` is permissionless (no owner gate at all -- see its
    docstring for why: the final word belongs to a second GenLayer
    consensus round, never a human), but it still enforces the state
    machine: it must reject on an attempt that was never appealed. Cheap,
    deterministic, and doesn't need to reach the live LLM path this
    method's success case requires."""
    treasury = accounts[1].address
    arbiter = accounts[2].address
    challenger = accounts[3]
    stranger = accounts[4]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )

    # A total stranger may call it (permissionless) -- it still correctly
    # rejects, but for state-machine reasons (never appealed), not access
    # control. This is itself part of the proof that no human gate exists
    # here anymore.
    tx = contract.connect(stranger).resolve_appeal(args=[0, 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert not tx_execution_succeeded(tx), "resolve_appeal must reject an attempt that was never appealed"


# ============================================================================
# Settlement transparency -- proves the human-ruling tier (the arbiter)
# cannot silently substitute its own verdict for AI consensus: every human
# ruling requires written justification on-chain, appealing always
# escalates to a second independent GenLayer consensus round (never a
# human's final word -- see `resolve_appeal`), and whether an UNAPPEALED
# arbiter ruling actually changed the economic outcome (vs merely
# confirming what AI already decided) is recorded per-attempt and rolled
# up into a contract-wide, always-queryable counter
# (`get_settlement_transparency`).
# ============================================================================


def test_resolve_dispute_rejects_empty_resolution_note(accounts):
    treasury = accounts[1].address
    arbiter_account = accounts[2]
    arbiter = arbiter_account.address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(contract, arbiter, bond=0)
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).raise_dispute(args=[0, 0, "Disputing directly"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )

    tx = contract.connect(arbiter_account).resolve_dispute(
        args=[0, 0, "APPROVE", "", 0]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert not tx_execution_succeeded(tx), "a bare verdict with no written justification must be rejected"


def test_human_override_flagged_and_counted_when_no_prior_ai_verdict_exists(direct_vm, direct_deploy, direct_accounts):
    """
    The sharpest, most direct proof that a human ruling cannot silently
    stand in for AI consensus: this attempt is disputed and resolved by
    the arbiter WITHOUT ever going through `request_verification` at all
    (disputable straight from ACCEPTED -- see `_ATTEMPT_LIVE_STATES`). By
    definition there is no AI verdict for the arbiter's ruling to agree
    with, so `human_verdict_overrode_ai` must be True and the ruling must
    land in `attempts_settled_by_human_override`, never
    `attempts_settled_by_ai_consensus` -- a human deciding an attempt's
    fate from scratch is exactly the case the transparency counters exist
    to surface, not hide.

    Runs via `gltest.direct` (deterministic, offline, real elapsed-time
    control) since it needs to advance past the 2-day appeal window --
    see the sibling test below for why `direct_vm.warp()` alone doesn't
    do that for this contract and `gl.message_raw["datetime"]` is patched
    directly instead.
    """
    import sys
    import datetime as dt

    treasury = direct_accounts[1]
    arbiter = direct_accounts[2]
    challenger = direct_accounts[3]
    contract = direct_deploy("proof_bounty.py", treasury, 250)

    direct_vm.value = 5 * 10**18
    contract.create_bounty(
        "Prove the docs contradiction", "The docs at X claim Y but the code does Z.",
        "POSITIVE", "OPEN_SOURCE", VALID_CRITERIA, VALID_EVIDENCE_REQS, arbiter, ONE_HOUR, 0,
    )
    direct_vm.value = 0

    with direct_vm.prank(challenger):
        contract.accept_bounty(0)
        contract.raise_dispute(0, 0, "Escalating before any AI verification -- I want the arbiter's direct read.")

    before = contract.get_settlement_transparency()
    assert before["attempts_settled_by_ai_consensus"] == 0
    assert before["attempts_settled_by_human_override"] == 0

    with direct_vm.prank(arbiter):
        contract.resolve_dispute(0, 0, "APPROVE", "Reviewed manually and consider the claim substantiated.", 0)

    attempt = contract.get_attempt(0, 0)
    assert attempt["status_label"] == "ARBITER_RESOLVED_PENDING_APPEAL"
    assert attempt["human_verdict_overrode_ai"] is True, "no prior AI verdict existed -- this MUST count as an override, not an agreement"

    gl = sys.modules["genlayer.gl"]
    future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=3)
    gl.message_raw["datetime"] = future.isoformat().replace("+00:00", "Z")

    contract.finalize_arbiter_resolution(0, 0)

    attempt_final = contract.get_attempt(0, 0)
    assert attempt_final["status_label"] == "WON"

    after = contract.get_settlement_transparency()
    assert after["attempts_settled_by_ai_consensus"] == 0, "AI never rendered a verdict on this attempt -- it must not be credited to AI"
    assert after["attempts_settled_by_human_override"] == 1
    assert after["total_settled_attempts"] == 1
    assert after["human_override_rate_bps"] == 10_000, "100% of settled attempts so far went through a human override"


def test_human_override_not_flagged_when_arbiter_agrees_with_ai_verdict(direct_vm, direct_deploy, direct_accounts):
    """
    The mirror-image proof: when a human ruling merely CONFIRMS what AI
    consensus already concluded, that must be recorded as AI-driven, not
    as a human override -- otherwise every routine, uncontested dispute
    would inflate the override rate and make the human tier look far more
    consequential than it actually is. Simulates the AI having already
    reached REJECTED by writing directly to `attempt.last_verdict`/
    `last_payout_bps` via the contract's own storage handle (available in
    `gltest.direct` mode, not a network call) rather than mocking GenVM's
    non-deterministic web/LLM primitives, which this test suite does not
    attempt to mock (see the live-network `@pytest.mark.llm` tests for
    genuine end-to-end AI-verdict coverage instead).
    """
    treasury = direct_accounts[1]
    arbiter = direct_accounts[2]
    challenger = direct_accounts[3]
    contract = direct_deploy("proof_bounty.py", treasury, 250)

    direct_vm.value = 5 * 10**18
    contract.create_bounty(
        "Prove the docs contradiction", "The docs at X claim Y but the code does Z.",
        "POSITIVE", "OPEN_SOURCE", VALID_CRITERIA, VALID_EVIDENCE_REQS, arbiter, ONE_HOUR, 0,
    )
    direct_vm.value = 0

    with direct_vm.prank(challenger):
        contract.accept_bounty(0)

    # Simulate an already-recorded AI REJECTED verdict directly on storage
    # (the real path is `request_verification`; this test isolates the
    # transparency-flag logic from GenVM's nondet plumbing on purpose).
    attempt_obj = contract._instance.attempts[contract._instance._attempt_key(0, 0)]
    attempt_obj.last_verdict = "REJECTED"
    attempt_obj.status = 1  # ATTEMPT_SUBMITTED -- a live state, disputable

    with direct_vm.prank(challenger):
        contract.raise_dispute(0, 0, "I believe the AI was right to reject this, but want a second opinion for the record.")

    with direct_vm.prank(arbiter):
        contract.resolve_dispute(0, 0, "REJECT", "Reviewed independently and agree with the AI's REJECTED verdict.", 0)

    attempt = contract.get_attempt(0, 0)
    assert attempt["human_verdict_overrode_ai"] is False, "the arbiter's ruling matches the AI's own verdict -- this is agreement, not an override"


@pytest.mark.llm
def test_resolve_appeal_is_decided_by_genlayer_consensus_not_a_human(accounts):
    """
    The direct proof that replacing the owner's personal judgment with a
    second GenLayer consensus round actually works end to end: real web
    fetch, real LLM consensus, permissionless call (no owner key
    involved at all -- the default signer here is the SAME account that
    raised the dispute, proving there is no owner gate to satisfy).
    """
    treasury = accounts[1].address
    arbiter_account = accounts[2]
    arbiter = arbiter_account.address
    challenger = accounts[3]
    contract = _deploy(treasury)
    _create_bounty(
        contract, arbiter, bond=0, category="DOCUMENTATION",
    )
    contract.connect(challenger).accept_bounty(args=[0]).transact(
        value=0, wait_transaction_status=TransactionStatus.FINALIZED
    )
    contract.connect(challenger).raise_dispute(args=[0, 0, "Escalating directly, no prior AI verdict on this attempt"]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    # Arbiter deliberately rules REJECT on a bounty whose real evidence
    # requirements point at GenLayer's own docs -- setting up a case where
    # a fresh, independent consensus review has a real, checkable
    # question to answer, not a foregone conclusion either way.
    tx_resolve = contract.connect(arbiter_account).resolve_dispute(
        args=[0, 0, "REJECT", "Arbiter's initial read without checking the live page closely", 0]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(tx_resolve)

    tx_appeal = contract.connect(challenger).appeal_arbiter_resolution(
        args=[0, 0, "The arbiter did not check the actual evidence page; requesting an independent review"]
    ).transact(value=0, wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(tx_appeal)
    attempt = contract.get_attempt(args=[0, 0]).call()
    assert attempt["status_label"] == "APPEALED"

    # Permissionless: called by the challenger themselves, not any
    # designated authority -- there is no owner key involved anywhere in
    # this test.
    tx_final = contract.connect(challenger).resolve_appeal(args=[0, 0]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert tx_execution_succeeded(tx_final), "resolve_appeal tx succeeded (real web fetch + real LLM consensus, no GenVM error)"

    attempt_final = contract.get_attempt(args=[0, 0]).call()
    # Whatever the fresh consensus concluded, the attempt must have reached
    # a real terminal state (or a defined non-terminal fallback state) --
    # never stuck in APPEALED.
    assert attempt_final["status_label"] != "APPEALED", "resolve_appeal must move the attempt out of APPEALED"
    assert attempt_final["pending_arbiter_verdict"] in (
        "APPROVED", "PARTIAL", "REJECTED", "NEEDS_REVISION", "INSUFFICIENT_EVIDENCE",
    ), "the final recorded verdict must be the fresh AI verdict vocabulary, not the arbiter's ARBITER_* one"

    transparency = contract.get_settlement_transparency(args=[]).call()
    assert transparency["attempts_settled_by_ai_consensus"] >= 1, "resolve_appeal's resolution must count toward AI consensus, not human override"
