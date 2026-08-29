# Security

## Threat model

PROOFBOUNTY handles real financial value (GEN) and evaluates
attacker-influenceable web content inside an Intelligent Contract. The
areas that matter most:

1. Contract escrow correctness (can money be stolen, double-spent, or
   permanently locked?)
2. Contract-side web fetching (can a malicious evidence URL do anything
   beyond return text to the LLM?)
3. Frontend wallet handling (can a user be tricked into signing something
   they didn't intend?)
4. Backend API (can the cache be poisoned, or the RPC budget be abused?)
5. Backend evidence archival (can a user-supplied URL be used to reach
   internal infrastructure the backend itself can see?)

## 1. Contract escrow safety

Every payout path in `contracts/proof_bounty.py` follows one discipline,
enforced by code review against two real external reviews of a sibling
project (`~/ic/docs/review.md`, `review2.md`) that caught exactly these
classes of bug:

- **Zero-then-transfer ordering.** The ledger field is read into a local,
  zeroed in storage, and the new status persisted — *before* any
  `_send_gen` call. A second call into the same payout path finds the
  ledger already at zero and reverts via an explicit guard
  (`if amount <= u256(0): raise gl.vm.UserError(...)`), before it can ever
  reach the transfer. This makes double-spend structurally impossible
  regardless of call ordering or reentrancy attempts.
- **Consensus-bound PARTIAL payouts.** A PARTIAL verdict's `payout_bps` is
  rounded onto a coarse 500-bps grid *inside* the non-deterministic closure,
  before the equivalence-principle comparison ever runs. This closes a real
  gap a sibling project's reviewers found: without bucketing, a leader
  could report any value inside a "close enough" tolerance band while the
  *specific* number that drives the payout was never actually agreed to by
  validators. See the module docstring's "AVOIDING UNDETERMINED /
  LEADER-ROTATION OUTCOMES" section for the full reasoning.
- **Dispute/timeout paths can't be routed around.** A `DISPUTED` attempt is
  explicitly excluded from the ordinary timeout-refund path — only
  `resolve_dispute` (arbiter) or `force_default_resolution` (after
  `deadline + ARBITER_GRACE_SECONDS`) can settle it. The second sibling-
  project review caught a version of this bug (disputed items bypassing
  the arbiter grace period via the ordinary timeout); it's designed out
  here from the start.
- **Every exit path is enumerated up front** in the module docstring
  (settle-to-winner, refund-lost-race, forfeit-bond, cancel, creator-
  timeout, arbiter-resolve, force-default) — there is no other way money
  leaves the contract than through `_send_gen`, the single choke point,
  which makes every transfer path discoverable by grepping one function
  name.

## 1b. Second-pass fixes from an external audit (2026-08-26)

A third-party audit scored the project 2,850/4,000 and flagged several
real gaps, addressed in `contracts/proof_bounty.py`. **All of the fixes
below have been confirmed live on a deployed contract at some point** —
verified directly against the deployed bytecode via `genlayer code
<address>`, not assumed from the source tree alone. See
`memory/MEMORY.md`'s "⚠️ CURRENT DEPLOYMENT STATE" block for the
current live address and the full live/retired address history —
that table, not this section, is the source of truth for which address
is live right now.

- **Settlement availability (DoS).** `_mark_other_attempts_lost_race`
  loops once over every attempt on a bounty every time it settles. Without
  a cap, an attacker could open enough low/no-bond attempts to make the
  eventual legitimate winner's own settlement transaction too expensive to
  execute — denial-of-service on the exact transaction meant to pay
  someone. Fixed with `MAX_ATTEMPTS_PER_BOUNTY = 40`, enforced in
  `accept_bounty`.
- **Zero-bond terminal-state stranding.** `_refund_attempt_bond` /
  `_forfeit_attempt_bond` used to unconditionally revert whenever
  `bond_deposited <= 0` — which meant a bounty with `required_bond = 0`
  (an explicitly supported, legitimate configuration) could never reach a
  terminal attempt state, reverting forever on nothing being wrong. Fixed:
  status transitions and transfers are now independent.
- **Evidence integrity manifest.** Every successful `request_verification`
  now stamps a deterministic content fingerprint (`evidence_content_hash`,
  pure-Python FNV-1a — no `hashlib` import, see `_content_digest`'s
  docstring for why) and `evidence_fetched_at` onto the attempt. The
  contract itself does not archive the page body (would require off-chain
  storage it doesn't have) — see section 5 below for the backend's
  independent archive, which does store the actual content and
  cross-checks its own digest against this on-chain fingerprint.
- **A fifth verdict, `INSUFFICIENT_EVIDENCE`.** Distinct from `REJECTED`
  (content unambiguously fails the criteria) and `NEEDS_REVISION` (a
  fixable technical defect): real, readable, on-topic content that simply
  doesn't settle the question either way. Exhausting the resubmission
  cycle on this verdict refunds the bond instead of forfeiting it and does
  not count against the challenger's rejection reputation — closing a gap
  where every ambiguous "the page is fine but doesn't say enough" case was
  previously forced into either a false REJECTED (unfairly penalizing a
  good-faith challenger) or an ill-fitting NEEDS_REVISION (implying a
  fixable technical problem that doesn't actually exist).
- **Lifecycle deadline enforcement.** `submit_evidence` now rejects after
  `bounty.deadline` (previously unbounded). `claim_creator_timeout` now
  requires `deadline + VERIFICATION_GRACE_SECONDS` (24h), closing a
  fairness gap in the other direction: without it, a creator could reclaim
  the reward the instant the deadline passed even while a legitimately
  on-time-submitted attempt sat unverified.
- **Arbiter trust / appeal path.** `resolve_dispute` no longer pays out
  immediately — it opens a 2-day appeal window
  (`ATTEMPT_ARBITER_RESOLVED_PENDING_APPEAL`) before the verdict executes.
  Either party may post an appeal bond to escalate to the protocol owner's
  final ruling (`resolve_appeal`) before the window closes; otherwise
  anyone may permissionlessly `finalize_arbiter_resolution` afterward.
  This is deliberately NOT a full staked multi-arbiter marketplace with
  slashing/voting — that's a legitimately larger protocol redesign. The
  owner is already the sole trusted party for every other admin function
  in this contract (fee/treasury/pause); extending that same, disclosed
  trust boundary to be the appeal backstop is a smaller and more honest
  surface than inventing a new unstaked authority for this one purpose.

## 2. Contract-side web fetching

`_collect_verdict` calls `gl.nondet.web.render(evidence_url, mode="text")`
— GenLayer's own sandboxed nondeterministic web-fetch primitive, not a
raw HTTP client the contract author controls. This means:

- The contract itself has no ability to make arbitrary network requests
  outside what `gl.nondet.web.render` permits — SSRF-style attacks against
  internal infrastructure are GenVM's responsibility to prevent, not this
  contract's.
- A dead/unreachable/malicious-response URL cannot crash the transaction:
  fetch failures are caught and degrade to a deterministic
  `NEEDS_REVISION` verdict, which every validator reaches identically.
- Fetched content is truncated to `WEB_FETCH_CHAR_LIMIT` (12,000 chars)
  before being placed in the LLM prompt, bounding worst-case prompt size
  regardless of how large the live page is.
- The evaluation prompt explicitly instructs the model to judge only the
  fetched content, never the challenger's own `evidence_description` —
  this is what prevents "convince the LLM via a good story" attacks; the
  LLM only ever sees the same text every validator independently fetched.

**Not yet handled at the application layer**: the frontend does not
independently validate `evidence_url` beyond checking it starts with
`http://`/`https://` (see `submit_evidence` client-side validation in
`components/bounty/AttemptCard.tsx` and the contract's own check). Full
SSRF protection (blocking private IP ranges, cloud metadata endpoints,
non-HTTP schemes) is GenVM's responsibility for the contract's own fetch;
if a future feature adds *server-side* fetching from the backend (e.g. an
evidence-preview feature), that would need its own SSRF-hardened fetcher —
none exists yet because the backend never fetches evidence URLs itself.

## 3. Frontend wallet handling

- **No custody, regardless of connection method.** Wallet connection goes
  through Reown AppKit (`lib/reown-config.ts`, `lib/wallet-context.tsx`),
  which supports injected extensions (MetaMask, etc.), WalletConnect
  (QR-paired mobile wallets), and Coinbase Wallet — but every path ends
  the same way: the wallet the user connects is the same wallet every
  payout goes to directly. Reown never gives this application custody of
  keys, seed phrases, or signing authority; it only brokers the
  connection handshake and hands back a standard EIP-1193 provider that
  `genlayer-js` uses to request signatures the wallet itself prompts the
  user to approve. There is no server-side key anywhere in this stack,
  nothing for this application to leak.
- **WalletConnect pairing is end-to-end encrypted between the wallet app
  and this dApp**, relayed (not read) by WalletConnect's relay network —
  this app never sees session keys or signing material, only the
  resulting signed transaction/message the wallet returns.
- **The Reown project ID is public by design**, not a secret needing
  protection (see `docs/ENVIRONMENT.md`) — it identifies the app to
  Reown's infrastructure for analytics/rate-limiting, not the user, and
  grants no access to funds or signing.
- **Full transaction lifecycle surfaced to the user** before and after
  every signature (`lib/use-contract-write.ts`) — the user always sees
  what they're about to sign fail into a specific, named state
  (`USER_REJECTED`, `INSUFFICIENT_FUNDS`, `WRONG_NETWORK`, etc.) rather
  than a generic error or a silent no-op.
- **Exact-value bond/reward checks happen contract-side** (`accept_bounty`
  and `create_bounty` both reject any `gl.message.value` that isn't an
  exact match) — the frontend's own pre-flight amount display is
  convenience only, never trusted as the actual guard.

## 4. Backend API

- **Read-only.** `apps/api` never holds a private key and never submits a
  transaction; every route in `src/routes/` is a `GET` over cached data.
- **Rate limiting**: `@fastify/rate-limit` caps clients at 120 req/min
  per IP against the public API, independent of the Redis-based GenLayer
  RPC pacer (which protects the *outbound* budget to GenLayer, a separate
  concern from inbound abuse of this API).
- **CORS is scoped** to the deployed frontend origin
  (`CORS_ORIGIN=https://proof-bounty.vercel.app`) plus `localhost:3000`
  for local dev — verified live via
  `curl -H "Origin: ..." -I https://proofbounty-api.fly.dev/bounties`.
- **No secrets ever logged or returned to clients**: the global error
  handler in `src/server.ts` returns internal error details only for 4xx
  (client) errors; 5xx messages are sanitized to a generic string, full
  detail goes to server logs only.
- **Cache poisoning risk is bounded by construction**: every cached row
  is a direct, unmodified copy of a contract view-method's return value —
  there's no user-submitted data path into the database that bypasses the
  contract itself, so an attacker can't inject arbitrary cache rows
  without first getting the contract to accept the underlying transaction.

## 5. Backend evidence archival

`apps/api/src/services/evidence-archiver.ts` independently, server-side,
re-fetches every evidence URL a challenger submits — a URL supplied by an
untrusted party (any bounty challenger), so it gets the full SSRF
treatment:

- **DNS-rebinding-safe.** DNS is resolved once, every resolved address is
  validated against the private/reserved-IP blocklist below, and the
  actual outbound connection is opened directly against that validated IP
  (via `node:http`/`node:https`, with `Host`/SNI still set to the real
  hostname so virtual-hosting and TLS certificate validation both still
  work correctly) — **not** by handing the hostname to `fetch()`, which
  would re-resolve DNS itself moments later and open a TOCTOU window for
  an attacker to rebind the same name to a private address between the
  safety check and the actual connection.
- **Private/reserved IP blocking**, including the specific cloud-metadata
  endpoint (`169.254.169.254`) that's the classic SSRF-to-credential-theft
  target: IPv4 loopback (`127.0.0.0/8`), `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0/8`; IPv6 loopback (`::1`),
  unique-local (`fc00::/7`), link-local (`fe80::/10`).
- **Scheme restricted** to `http:`/`https:` only; `localhost`/`*.localhost`
  hostnames explicitly refused even before DNS resolution.
- **Redirects are re-validated from scratch**, not trusted — each hop
  through a redirect chain gets the same full `assertSafeUrl` treatment
  (fresh DNS resolution, fresh IP-pinning) as the original URL, up to
  `MAX_REDIRECTS = 5`. A redirect chain is exactly the kind of
  attacker-controlled input SSRF checks exist for.
- **Bounded resource consumption**: 10s fetch timeout, 2MB response-size
  cap (enforced during streaming, not after buffering the whole body),
  500,000-char bounded storage per archived row.
- **Real cryptographic hashing.** Node's `crypto.createHash("sha256")` —
  chosen deliberately over changing the *contract's* hash mechanism,
  because this project was previously bitten by assuming an unverified
  stdlib import (`hashlib`) would work inside GenVM's constrained sandbox
  (see the `_content_digest` docstring); Node has zero such uncertainty.
- **Never blocks or fails the caller.** A failed archive attempt records
  its own error (`fetchError`) rather than raising — archival is a
  best-effort provenance layer, never allowed to interfere with the
  indexer's core poll loop or any payment-critical path.

The archive endpoints (`GET /bounties/:id/attempts/:index/evidence-archive`,
`GET /evidence-archive/:archiveId`) are read-only and deliberately exclude
the full `content` field from the list response (could be up to 500KB per
row) — fetch it explicitly via the detail route when actually needed.

## Known accepted risks

- **`deepmerge-ts` <8.0.0 advisory** (stack-exhaustion DoS), pulled in
  transitively via Prisma's CLI tooling (`@prisma/config` →
  `@prisma/composer-cli` → `alchemy`). Only reachable through Prisma's own
  `migrate`/`generate` commands against attacker-controlled input, which
  this project never does (schema is static, migrations are authored by
  the team, not user input). Fixing it requires Prisma 7/8's breaking
  `prisma.config.ts` migration — deferred, see `memory/MEMORY.md`.
- **`axios` <1.17.0 advisory bundle** (prototype pollution, DoS via
  recursive form serialization, several related CVEs), pulled in
  transitively via `@reown/appkit-adapter-ethers` → `@coinbase/cdp-sdk`
  (Coinbase's embedded-wallet/x402-payments SDK). This app only uses
  Reown for ordinary wallet-connect (injected/WalletConnect/Coinbase
  Wallet signing) — it never invokes Coinbase's embedded payment flow
  that would actually exercise this axios instance client-side. Fixing it
  would require a breaking downgrade of Reown's own adapter package for a
  code path this app doesn't reach. Also see the `next.config.ts`
  `serverExternalPackages` workaround needed for the same transitive
  dependency (memory/MEMORY.md, "Wallet connect fixed" entry) — same root
  cause (an unused Coinbase payments sub-dependency), two different
  surfacing symptoms (a build error and an audit finding).
- **Evidence archive is not a guaranteed match for what validators judged.**
  The backend's archive (section 5) is a *separate*, asynchronous fetch —
  not the literal bytes each validator's non-deterministic `gl.nondet.web.render`
  call saw (GenVM doesn't expose that data back to the contract or this
  backend). A mismatch between the archive's digest and the on-chain
  fingerprint is expected for markup-heavy pages (the contract's fetch
  strips HTML to plain text; the archive stores the raw HTTP body) and is
  surfaced as an observable `onChainHashMatch` field rather than hidden —
  see `docs/ARCHITECTURE.md`'s "Evidence provenance" section. Closing this
  fully would need either GenVM exposing validator-fetched content or a
  decentralized archival layer (IPFS/Arweave) this project doesn't have
  configured; both are legitimate future scope, not silently unaddressed.
- **Postgres migrations must always ship with a default when adding a
  required column to a table that could already have rows.** This project
  had exactly this near-miss once (`evidence_archives.local_content_digest`)
  — safe only because the table happened to be empty at the time that
  migration ran. Fixed with a `@default("")` and a safe forward migration;
  the standing discipline going forward is to never skip the default just
  because a table is empty *today*.
