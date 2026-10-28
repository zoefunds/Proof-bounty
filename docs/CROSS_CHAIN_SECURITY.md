# Cross-chain funding and settlement security

ProofBounty deliberately separates adjudication from custody. GenLayer is
the adjudication system of record; `ProofBountyEscrow` on Base Sepolia is the
USDC custodian. Base cannot verify GenLayer consensus natively, so a cross-chain
attestor and settlement signer remain explicit testnet trust assumptions.

## Funding protocol

1. A challenger calls `reserve_attempt` on GenLayer. The reservation records
   their identity and expires after two hours. It is not an adjudication
   attempt, does not lock criteria, and does not consume the 40 funded-attempt
   cap.
2. The authorization service reads the reservation directly from finalized
   GenLayer state. It signs a short-lived EIP-712 `FundAttempt` instruction
   binding bounty, reservation, challenger, exact bond, GenLayer contract,
   Base chain, escrow address, and expiry.
3. Base `fundAttempt` requires `msg.sender` to be that challenger. Another
   wallet cannot use the signature or occupy the reservation.
4. The confirmation service verifies the successful Base receipt and exact
   `AttemptFundingReserved` event. The configured GenLayer funding attestor
   activates the reservation, producing the final attempt index. The Base
   relay then binds that index to the same reservation, challenger, and Base
   funding transaction under a second EIP-712 authorization.

Only activated reservations become adjudication attempts. The frontend reads
the finalized reservation, never a preflight `attempt_count`, and retains the
Base transaction in local recovery state until binding succeeds.

## Settlement boundary

The Base contract cannot independently prove a GenLayer verdict. The
settlement service therefore remains trusted to report finalized GenLayer
state correctly. Compromise or collusion of the configured Base relayer and
decision signer can authorize an incorrect settlement. This is not described
as trustless bridging.

The two keys are distinct on-chain identities, but the current testnet service
loads both from encrypted secrets on the same Fly application. That separation
protects against a leaked relay transaction key alone; it does not protect
against compromise of the entire service host.

The boundary is narrowed as follows:

- the relay re-reads the bounty and attempt directly from GenLayer before
  signing; the Postgres index is discovery/cache only;
- the EIP-712 instruction binds every economic field plus a canonical hash of
  the fresh GenLayer state;
- each bounty has a strictly increasing decision nonce;
- every instruction has `validAfter` and `validBefore` bounds;
- state hashes are single-use, and the escrow independently enforces funded
  challenger identity, payout conservation, recipient rules, and one-time
  settlement;
- the transaction sender must be the configured relayer and the authorization
  must recover the separately configured decision signer.

Tests prove wrong callers, wrong signers, field tampering, stale nonces,
expired authorizations, replay, conflicting outcomes, and challenger mismatch
cannot move funds. For mainnet, the decision signer should be moved to an
independent policy service or threshold/multisig oracle rather than sharing an
operational host with the relay.

## Recovery

- An unregistered or mismatched bounty deposit is recoverable by its creator
  after seven days with no privileged signature.
- An unbound attempt deposit is recoverable by its challenger after its
  authorization expiry plus 24 hours, also without a privileged signature.
- Successful funding confirmations are idempotent. The frontend persists the
  reservation and Base transaction hash and exposes **Retry binding**.
- If the service remains unavailable, the frontend exposes **Recover unbound
  bond**. Recovered funds are credited to the normal pull-claim ledger.
- A creator whose GenLayer creation succeeded but whose Base transaction
  failed can retry the exact reward deposit from the bounty page. The same
  page exposes delayed orphan recovery.

Recovery never performs a direct token push; users call `claim()` after the
escrow credits their balance.

## Reproducible verification

```bash
forge test -vv
gltest tests/integration -v -s -k "is_a_safe_noop or human_override"
cd apps/api && npm ci && npm run build
cd ../web && npm ci && npm run lint && npx tsc --noEmit && npm run build
```

`testEndToEndFundBindSettleAndRecipientClaim` covers the complete Base custody
path. The GenLayer direct tests prove unfunded reservations cannot consume
attempt capacity and unauthorized callers cannot activate them.
