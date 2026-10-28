# Security and operations

## Assets and trust

Base Sepolia `ProofBountyEscrow` is the only token custodian. GenLayer stores
adjudication state and is non-payable. Postgres, Redis, and the evidence archive
are not monetary sources of truth.

Base cannot independently prove GenLayer consensus. The configured relayer and
decision signer can jointly authorize settlement. They are separate keys but
currently run on the same Fly service. Compromise of the whole host can produce
an incorrect settlement; production mainnet use requires independent or
threshold authorization infrastructure.

## Contract controls

- EIP-712 domains bind instructions to Base chain ID and escrow address.
- Bounty funding binds the finalized GenLayer creator, bounty ID, reward, bond,
  fee, GenLayer contract, and expiry. Delayed orphan recovery deletes the Base
  slot, so an invalid or abandoned deposit cannot block the ID permanently.
- Attempt funding binds bounty, reservation, challenger, exact bond, GenLayer
  contract, and expiry.
- Appeal funding binds the finalized GenLayer appellant, bounty, attempt,
  exact appeal bond, GenLayer contract, and expiry. Positive-bond appeals gain
  no review rights until attestor-verified Base funding is bound and that
  binding is separately attested back to GenLayer. Reservations expire after
  two hours. Unbound deposits recover 24 hours after authorization expiry;
  bound, unsettled deposits recover after the seven-day orphan delay only with
  a short-lived decision-signer authorization derived from fresh finalized
  GenLayer state proving zero declared appeal bond and no recipient. Active or
  adversely finalized appeals remain nonrecoverable and fully allocatable.
- Binding authorizations bind the finalized attempt index and Base funding
  transaction hash.
- Settlement binds all economic fields, canonical state hash, nonce, and time
  window.
- State hashes are single-use; bounty decision nonces are strictly increasing.
- Reward and attempt ledgers settle once. Pull claims use checks-effects-
  interactions and a reentrancy guard.
- USDC conservation, fee bounds, recipient identity, and appeal recipients are
  enforced on-chain.
- Creator recovery after seven days and challenger recovery after funding
  authorization expiry plus 24 hours need no privileged signature.

## Funding attestation controls

The public authorization route does not trust the caller's claimed identity.
It reads the finalized reservation and signs only for its recorded challenger.
Confirmation verifies the Base receipt succeeded, targeted the escrow, emitted
the exact funding event, and matches the pending position before submitting a
GenLayer attestation. Anyone may request confirmation, but they cannot change
the bound challenger or transaction.

The frontend stores a pending reservation and Base transaction hash locally so
users can retry binding even after the bounty stops accepting new attempts.
Recovery remains possible if the service is down. If GenLayer activation won
the race but Base binding failed, recovery credits and zeroes the bond while
leaving the reservation bindable; a later zero-bond bind preserves the reward
settlement path without duplicating the bond.

## Backend controls

- Settlement discovery may use Postgres, but authorization uses fresh direct
  GenLayer reads.
- GenLayer reads and Redis pacing calls have hard timeouts.
- Shared Redis counters pace the 30/minute, 480/hour, and 4,800/day backend RPC
  budgets. Hour/day exhaustion fails fast instead of wedging the poll loop.
- Zod validates environment configuration at startup.
- CORS is restricted to the production frontend.
- Fastify errors return generic client messages; detailed failures stay in
  server logs.
- Service keys are encrypted Fly secrets and must never appear in source,
  `.env.example`, logs, screenshots, or support messages.

## Evidence URL handling

The independent archive treats every URL as hostile:

- only HTTP and HTTPS are accepted;
- localhost, private, loopback, link-local, and reserved addresses are blocked;
- DNS answers are validated and the outbound connection is pinned to a checked
  address to resist rebinding;
- every redirect is revalidated;
- timeout, redirect count, response size, and stored content are bounded;
- archive failure never blocks adjudication or settlement.

The on-chain FNV-1a fingerprint is a deterministic drift indicator, not a
cryptographic commitment. The archive's SHA-256 is stronger but remains an
off-chain observation. Neither proves the exact bytes every validator saw.

## Incident response

If a service key is suspected compromised:

1. Stop or scale down the Fly relay.
2. Rotate the affected on-chain role from the owner account.
3. Replace the encrypted Fly secret.
4. Re-fund only the new relayer address with testnet ETH.
5. Inspect Base decisions, nonces, state hashes, pending attempts, and
   claimable balances before resuming.
6. Redeploy, verify health, and document the rotation.

If GenLayer RPC is degraded, leave the relay stopped rather than authorizing
from stale cache. Existing unbound users retain signature-free recovery.

## Known accepted testnet limitations

- The relay and decision signer share an operational host.
- There is no light client, bridge proof, or threshold oracle verifying
  GenLayer on Base.
- Base cannot prove appeal expiry. Bound appeal recovery therefore uses a
  fresh state-bound decision-signer authorization after the seven-day delay.
  This oracle must be replaced by verified or threshold-authorized
  cross-chain state before mainnet.
- Owner and treasury are an externally owned testnet account, not a multisig.
- Evidence is not pinned to IPFS or Arweave.
- Notifications are polling-based, not guaranteed delivery.

See [CROSS_CHAIN_SECURITY.md](CROSS_CHAIN_SECURITY.md) for protocol detail and
[VERIFICATION.md](VERIFICATION.md) for executable checks.
