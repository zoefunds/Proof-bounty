import { Contract, Interface, JsonRpcProvider, Wallet, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { attestAttemptFunding, readContract } from "../lib/genlayer.js";
import { planAppealSettlement } from "./appeal-reconciliation.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const ABI = [
  "function bounties(uint256) view returns (address creator,uint256 reward,uint256 requiredBond,uint16 feeBps,uint64 fundedAt,address genlayerContract,bool registered,bool rewardSettled,uint256 decisionNonce)",
  "function pendingAttempts(uint256,uint256) view returns (address challenger,uint256 bond,uint64 fundedAt,uint64 authorizationExpiry,bool bound,bool recovered)",
  "function attempts(uint256,uint256) view returns (address challenger,uint256 bond,uint256 appealBond,address appealPayer,bool settled,uint256 reservationId)",
  "function registerBounty(uint256 bountyId,address genlayerContract,bytes authorization)",
  "function bindAttempt(uint256 bountyId,uint256 reservationId,uint256 attemptIndex,bytes32 baseFundingTxHash,bytes authorization)",
  "function executeDecision(uint256 bountyId,uint256 attemptIndex,uint8 outcomeCode,uint16 payoutBps,address recipient,address appealRecipient,bytes32 genlayerStateHash,uint256 decisionNonce,uint64 validAfter,uint64 validBefore,bytes authorization)",
  "event AttemptFundingReserved(uint256 indexed bountyId,uint256 indexed reservationId,address indexed challenger,uint256 bond,uint64 authorizationExpiry)",
];

type Logger = { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };
type Reservation = { bounty_id: number; reservation_id: number; challenger: string; status_label: string; funding_deadline: number; activated_attempt_index: number; base_funding_tx_hash: string };
type LiveBounty = { creator: string; reward_amount: number; required_bond: number; platform_fee_bps: number; status_label: string; winning_attempt_index: number };
type LiveAttempt = { challenger: string; status_label: string; last_payout_bps: number; last_verdict: string; appeal_bond_recipient: string; resolved_at: number };

let running = false;
function configured() { return !!(env.BASE_ESCROW_ADDRESS && env.BASE_RELAYER_PRIVATE_KEY && env.BASE_DECISION_SIGNER_PRIVATE_KEY); }
function key(value: string) { return value.startsWith("0x") ? value : `0x${value}`; }
function context() {
  if (!configured()) throw new Error("Base relay is not configured");
  const provider = new JsonRpcProvider(env.BASE_SEPOLIA_RPC_URL, 84532, { staticNetwork: true });
  const relayer = new Wallet(key(env.BASE_RELAYER_PRIVATE_KEY!), provider);
  const signer = new Wallet(key(env.BASE_DECISION_SIGNER_PRIVATE_KEY!));
  const escrow = new Contract(env.BASE_ESCROW_ADDRESS!, ABI, relayer);
  const domain = { name: "ProofBountyEscrow", version: "1", chainId: 84532, verifyingContract: env.BASE_ESCROW_ADDRESS! };
  return { provider, signer, escrow, domain };
}

export async function createBountyFundingAuthorization(bountyId: number, creator: string) {
  const { signer, escrow, domain } = context();
  const normalized = getAddress(creator);
  const live = await readContract<LiveBounty>("get_bounty", [bountyId]);
  if (getAddress(live.creator) !== normalized) throw new Error("caller is not the finalized GenLayer bounty creator");
  const base = await escrow.bounties(bountyId);
  if (base.creator !== ZERO) throw new Error("Base bounty slot is already funded");
  const authorizationExpiry = Math.floor(Date.now() / 1000) + 15 * 60;
  const authorization = await signer.signTypedData(domain, { FundBounty: [
    { name: "bountyId", type: "uint256" }, { name: "creator", type: "address" },
    { name: "reward", type: "uint256" }, { name: "requiredBond", type: "uint256" },
    { name: "feeBps", type: "uint16" }, { name: "genlayerContract", type: "address" },
    { name: "authorizationExpiry", type: "uint64" },
  ] }, { bountyId, creator: normalized, reward: live.reward_amount, requiredBond: live.required_bond, feeBps: live.platform_fee_bps, genlayerContract: env.PROOFBOUNTY_CONTRACT_ADDRESS, authorizationExpiry });
  return { authorization, authorizationExpiry, reward: String(live.reward_amount), requiredBond: String(live.required_bond), feeBps: live.platform_fee_bps, genlayerContract: env.PROOFBOUNTY_CONTRACT_ADDRESS };
}

export async function createAppealFundingAuthorization(bountyId: number, attemptIndex: number, appellant: string) {
  const { signer, escrow, domain } = context();
  const normalized = getAddress(appellant);
  const fresh = await readContract<LiveAttempt & { appealed_by: string; appeal_bond_deposited: number }>("get_attempt", [bountyId, attemptIndex]);
  if (fresh.appealed_by === ZERO) throw new Error("GenLayer attempt has no finalized appellant");
  if (getAddress(fresh.appealed_by) !== normalized) throw new Error("caller is not the finalized GenLayer appellant");
  const base = await escrow.bounties(bountyId);
  const bound = await escrow.attempts(bountyId, attemptIndex);
  if (BigInt(fresh.appeal_bond_deposited) !== base.requiredBond) throw new Error("GenLayer appeal bond does not match the Base bounty terms");
  // Reward settlement may belong to a different winning attempt; it must not
  // prevent this still-unsettled attempt from reconciling its own appeal bond.
  if (!base.registered || bound.challenger === ZERO || bound.settled || bound.appealBond !== 0n) throw new Error("Base appeal position is unavailable");
  const authorizationExpiry = Math.floor(Date.now() / 1000) + 15 * 60;
  const authorization = await signer.signTypedData(domain, { FundAppeal: [
    { name: "bountyId", type: "uint256" }, { name: "attemptIndex", type: "uint256" },
    { name: "appellant", type: "address" }, { name: "bond", type: "uint256" },
    { name: "genlayerContract", type: "address" }, { name: "authorizationExpiry", type: "uint64" },
  ] }, { bountyId, attemptIndex, appellant: normalized, bond: base.requiredBond, genlayerContract: base.genlayerContract, authorizationExpiry });
  return { authorization, authorizationExpiry, bond: base.requiredBond.toString() };
}

export async function createAttemptFundingAuthorization(bountyId: number, reservationId: number, challenger: string) {
  const { signer, escrow, domain } = context();
  const normalized = getAddress(challenger);
  const reservation = await readContract<Reservation>("get_attempt_reservation", [reservationId]);
  if (reservation.bounty_id !== bountyId || reservation.reservation_id !== reservationId || reservation.status_label !== "PENDING_FUNDING") throw new Error("reservation is not pending for this bounty");
  if (getAddress(reservation.challenger) !== normalized) throw new Error("reservation challenger does not match caller");
  const base = await escrow.bounties(bountyId);
  if (!base.registered || base.rewardSettled) throw new Error("Base bounty is not available");
  if (getAddress(base.genlayerContract) !== getAddress(env.PROOFBOUNTY_CONTRACT_ADDRESS)) throw new Error("Base bounty is bound to a different GenLayer contract");
  const now = Math.floor(Date.now() / 1000);
  const authorizationExpiry = Math.min(reservation.funding_deadline, now + 15 * 60);
  if (authorizationExpiry <= now + 30) throw new Error("reservation is too close to expiry; create a new reservation");
  const authorization = await signer.signTypedData(domain, { FundAttempt: [
    { name: "bountyId", type: "uint256" }, { name: "reservationId", type: "uint256" }, { name: "challenger", type: "address" },
    { name: "bond", type: "uint256" }, { name: "genlayerContract", type: "address" }, { name: "authorizationExpiry", type: "uint64" },
  ] }, { bountyId, reservationId, challenger: normalized, bond: base.requiredBond, genlayerContract: base.genlayerContract, authorizationExpiry });
  return { authorization, authorizationExpiry, bond: base.requiredBond.toString() };
}

export async function confirmAttemptFunding(bountyId: number, reservationId: number, challenger: string, baseFundingTxHash: string) {
  const { provider, signer, escrow, domain } = context();
  const normalized = getAddress(challenger);
  const receipt = await provider.getTransactionReceipt(baseFundingTxHash);
  if (!receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== env.BASE_ESCROW_ADDRESS!.toLowerCase()) throw new Error("Base funding transaction is not a successful escrow call");
  const iface = new Interface(ABI);
  const event = receipt.logs.map((log) => { try { return iface.parseLog(log); } catch { return null; } })
    .find((log) => log?.name === "AttemptFundingReserved" && Number(log.args.bountyId) === bountyId && Number(log.args.reservationId) === reservationId);
  if (!event || getAddress(event.args.challenger) !== normalized) throw new Error("funding event does not match reservation challenger");
  let reservation = await readContract<Reservation>("get_attempt_reservation", [reservationId]);
  if (reservation.bounty_id !== bountyId || getAddress(reservation.challenger) !== normalized) throw new Error("GenLayer reservation mismatch");
  const pending = await escrow.pendingAttempts(bountyId, reservationId);
  if (getAddress(pending.challenger) !== normalized) throw new Error("Base pending funding mismatch");
  if (pending.recovered && reservation.status_label !== "ACTIVATED") throw new Error("recovered reservation cannot be activated after recovery");
  let genlayerTxHash = reservation.base_funding_tx_hash;
  if (reservation.status_label === "PENDING_FUNDING") {
    genlayerTxHash = await attestAttemptFunding(bountyId, reservationId, baseFundingTxHash);
    reservation = await readContract<Reservation>("get_attempt_reservation", [reservationId]);
  }
  if (reservation.status_label !== "ACTIVATED" || reservation.base_funding_tx_hash.toLowerCase() !== baseFundingTxHash.toLowerCase()) throw new Error("GenLayer did not activate this exact Base funding transaction");
  const attemptIndex = reservation.activated_attempt_index;
  const bound = await escrow.attempts(bountyId, attemptIndex);
  if (bound.challenger !== ZERO) {
    if (getAddress(bound.challenger) !== normalized || Number(bound.reservationId) !== reservationId) throw new Error("attempt index is bound to conflicting funding");
    return { attemptIndex, genlayerTxHash, baseBindingTxHash: null, alreadyBound: true };
  }
  const authorization = await signer.signTypedData(domain, { BindAttempt: [
    { name: "bountyId", type: "uint256" }, { name: "reservationId", type: "uint256" }, { name: "attemptIndex", type: "uint256" },
    { name: "challenger", type: "address" }, { name: "baseFundingTxHash", type: "bytes32" },
  ] }, { bountyId, reservationId, attemptIndex, challenger: normalized, baseFundingTxHash });
  const tx = await escrow.bindAttempt(bountyId, reservationId, attemptIndex, baseFundingTxHash, authorization);
  await tx.wait();
  return { attemptIndex, genlayerTxHash, baseBindingTxHash: tx.hash, alreadyBound: false };
}

export async function relayBaseOnce(logger: Logger) {
  if (!configured() || running) return;
  running = true;
  try {
    const { signer, escrow, domain } = context();
    const rows = await prisma.bounty.findMany({ include: { attempts: true }, orderBy: { bountyId: "asc" } });
    for (const cached of rows) {
      try {
        const live = await readContract<LiveBounty>("get_bounty", [cached.bountyId]);
        let base = await escrow.bounties(cached.bountyId);
        if (base.creator === ZERO) continue;
        if (!base.registered) {
          if (base.creator.toLowerCase() !== live.creator.toLowerCase() || base.reward !== BigInt(live.reward_amount) || base.requiredBond !== BigInt(live.required_bond) || Number(base.feeBps) !== live.platform_fee_bps) { logger.error({ bountyId: cached.bountyId }, "base relay: funded terms do not match fresh GenLayer state"); continue; }
          const authorization = await signer.signTypedData(domain, { Register: [
            { name: "bountyId", type: "uint256" }, { name: "creator", type: "address" }, { name: "reward", type: "uint256" }, { name: "requiredBond", type: "uint256" }, { name: "feeBps", type: "uint16" }, { name: "genlayerContract", type: "address" },
          ] }, { bountyId: cached.bountyId, creator: live.creator, reward: base.reward, requiredBond: base.requiredBond, feeBps: base.feeBps, genlayerContract: env.PROOFBOUNTY_CONTRACT_ADDRESS });
          await (await escrow.registerBounty(cached.bountyId, env.PROOFBOUNTY_CONTRACT_ADDRESS, authorization)).wait();
          base = await escrow.bounties(cached.bountyId);
        }
        if (!base.rewardSettled && ["CANCELLED", "EXPIRED_REFUNDED"].includes(live.status_label)) await execute(escrow, signer, domain, base, cached.bountyId, 0, 4, 0, live.creator, ZERO, live.status_label, live);
        for (const cachedAttempt of cached.attempts) {
          const fresh = await readContract<LiveAttempt>("get_attempt", [cached.bountyId, cachedAttempt.attemptIndex]);
          const baseAttempt = await escrow.attempts(cached.bountyId, cachedAttempt.attemptIndex);
          if (baseAttempt.challenger === ZERO || baseAttempt.settled) continue;
          if (getAddress(baseAttempt.challenger) !== getAddress(fresh.challenger)) { logger.error({ bountyId: cached.bountyId, attemptIndex: cachedAttempt.attemptIndex }, "base relay: bound challenger conflicts with fresh GenLayer state"); continue; }
          let outcome = 0; let payout = 0; let recipient = "";
          if (fresh.status_label === "WON") { outcome = 1; payout = fresh.last_payout_bps || 10_000; recipient = fresh.challenger; }
          else if (["LOST_RACE", "CANCELLED", "INSUFFICIENT_EVIDENCE_FINAL"].includes(fresh.status_label)) { outcome = 2; recipient = fresh.challenger; }
          else if (fresh.status_label === "BOND_FORFEITED") { outcome = 3; recipient = live.creator; }
          if (!outcome) continue;
          const appealPlan = planAppealSettlement({
            finalizedRecipient: fresh.appeal_bond_recipient,
            requiredBond: base.requiredBond,
            fundedBond: baseAttempt.appealBond,
            resolvedAt: fresh.resolved_at,
            now: Math.floor(Date.now() / 1000),
          });
          if (appealPlan.defer) {
            logger.error({ bountyId: cached.bountyId, attemptIndex: cachedAttempt.attemptIndex }, "base relay: finalized positive-bond appeal is inside its late-funding reconciliation window; settlement deferred");
            continue;
          }
          if (appealPlan.fundingWaived) {
            logger.error({ bountyId: cached.bountyId, attemptIndex: cachedAttempt.attemptIndex }, "base relay: appeal funding grace expired; settling core funds without a nonexistent appeal bond");
          }
          const appealRecipient = appealPlan.appealRecipient;
          await execute(escrow, signer, domain, base, cached.bountyId, cachedAttempt.attemptIndex, outcome, payout, recipient, appealRecipient, fresh.status_label, fresh);
          base = await escrow.bounties(cached.bountyId);
        }
      } catch (err) { logger.error({ bountyId: cached.bountyId, err }, "base relay: bounty sweep failed"); }
    }
  } finally { running = false; }
}

async function execute(escrow: Contract, signer: Wallet, domain: Record<string, unknown>, base: { decisionNonce: bigint }, bountyId: number, attemptIndex: number, outcome: number, payoutBps: number, recipient: string, appealRecipient: string, state: string, freshState: unknown) {
  const decisionNonce = base.decisionNonce + 1n;
  const now = Math.floor(Date.now() / 1000); const validAfter = now - 30; const validBefore = now + 10 * 60;
  const canonical = JSON.stringify({ genlayerContract: env.PROOFBOUNTY_CONTRACT_ADDRESS.toLowerCase(), bountyId, attemptIndex, outcome, payoutBps, recipient: recipient.toLowerCase(), appealRecipient: appealRecipient.toLowerCase(), state, freshState });
  const genlayerStateHash = keccak256(toUtf8Bytes(canonical));
  const authorization = await signer.signTypedData(domain, { Settle: [
    { name: "bountyId", type: "uint256" }, { name: "attemptIndex", type: "uint256" }, { name: "outcome", type: "uint8" }, { name: "payoutBps", type: "uint16" }, { name: "recipient", type: "address" }, { name: "appealRecipient", type: "address" }, { name: "genlayerStateHash", type: "bytes32" }, { name: "decisionNonce", type: "uint256" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" },
  ] }, { bountyId, attemptIndex, outcome, payoutBps, recipient, appealRecipient, genlayerStateHash, decisionNonce, validAfter, validBefore });
  await (await escrow.executeDecision(bountyId, attemptIndex, outcome, payoutBps, recipient, appealRecipient, genlayerStateHash, decisionNonce, validAfter, validBefore, authorization)).wait();
}

export function startBaseRelayer(logger: Logger) {
  if (!configured()) { logger.info({}, "base relay: disabled (configuration incomplete)"); return null; }
  void relayBaseOnce(logger);
  return setInterval(() => void relayBaseOnce(logger), env.BASE_RELAY_INTERVAL_MS);
}
