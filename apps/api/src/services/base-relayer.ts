import { Contract, JsonRpcProvider, Wallet, keccak256, solidityPacked } from "ethers";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";

const ABI = [
  "function bounties(uint256) view returns (address creator,uint256 reward,uint256 requiredBond,uint16 feeBps,uint64 fundedAt,address genlayerContract,bool registered,bool rewardSettled)",
  "function attempts(uint256,uint256) view returns (address challenger,uint256 bond,uint256 appealBond,address appealPayer,bool settled)",
  "function registerBounty(uint256 bountyId,address genlayerContract,bytes authorization)",
  "function executeDecision(uint256 bountyId,uint256 attemptIndex,uint8 outcomeCode,uint16 payoutBps,address recipient,address appealRecipient,bytes32 decisionHash,bytes authorization)",
];

type Logger = { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };
let running = false;

function configured() {
  return !!(env.BASE_ESCROW_ADDRESS && env.BASE_RELAYER_PRIVATE_KEY && env.BASE_DECISION_SIGNER_PRIVATE_KEY);
}

function key(value: string) { return value.startsWith("0x") ? value : `0x${value}`; }

export async function relayBaseOnce(logger: Logger) {
  if (!configured() || running) return;
  running = true;
  try {
    const provider = new JsonRpcProvider(env.BASE_SEPOLIA_RPC_URL, 84532, { staticNetwork: true });
    const relayer = new Wallet(key(env.BASE_RELAYER_PRIVATE_KEY!), provider);
    const signer = new Wallet(key(env.BASE_DECISION_SIGNER_PRIVATE_KEY!));
    const escrow = new Contract(env.BASE_ESCROW_ADDRESS!, ABI, relayer);
    const domain = { name: "ProofBountyEscrow", version: "1", chainId: 84532, verifyingContract: env.BASE_ESCROW_ADDRESS! };
    const genlayerContract = env.PROOFBOUNTY_CONTRACT_ADDRESS;
    const bounties = await prisma.bounty.findMany({ include: { attempts: true }, orderBy: { bountyId: "asc" } });

    for (const bounty of bounties) {
      try {
        let base = await escrow.bounties(bounty.bountyId);
        if (base.creator === "0x0000000000000000000000000000000000000000") continue;
        if (!base.registered) {
          if (base.creator.toLowerCase() !== bounty.creator.toLowerCase() || base.reward !== BigInt(bounty.rewardAmount) || base.requiredBond !== BigInt(bounty.requiredBond) || Number(base.feeBps) !== bounty.platformFeeBps) {
            logger.error({ bountyId: bounty.bountyId }, "base relay: funded terms do not match GenLayer; refusing registration");
            continue;
          }
          const authorization = await signer.signTypedData(domain, {
            Register: [
              { name: "bountyId", type: "uint256" }, { name: "creator", type: "address" },
              { name: "reward", type: "uint256" }, { name: "requiredBond", type: "uint256" },
              { name: "feeBps", type: "uint16" }, { name: "genlayerContract", type: "address" },
            ],
          }, { bountyId: bounty.bountyId, creator: bounty.creator, reward: base.reward, requiredBond: base.requiredBond, feeBps: base.feeBps, genlayerContract });
          await (await escrow.registerBounty(bounty.bountyId, genlayerContract, authorization)).wait();
          logger.info({ bountyId: bounty.bountyId }, "base relay: bounty registered");
          base = await escrow.bounties(bounty.bountyId);
        }

        if (!base.rewardSettled && ["CANCELLED", "EXPIRED_REFUNDED"].includes(bounty.statusLabel)) {
          await execute(escrow, signer, domain, bounty.bountyId, 0, 4, 0, bounty.creator, "0x0000000000000000000000000000000000000000", bounty.statusLabel);
        }

        // A direct GenLayer caller can create an unfunded attempt. Such an
        // attempt is allowed to adjudicate (GenLayer cannot read Base), but
        // it must never strand the creator's real USDC. If it wins without
        // the exact Base attempt bond/identity being present, refund the
        // reward instead of manufacturing an unbacked winner claim.
        if (!base.rewardSettled && bounty.statusLabel === "SETTLED") {
          const winner = bounty.attempts.find((a) => a.attemptIndex === bounty.winningAttemptIndex);
          const fundedWinner = winner ? await escrow.attempts(bounty.bountyId, winner.attemptIndex) : null;
          if (!winner || fundedWinner?.challenger.toLowerCase() !== winner.challenger.toLowerCase()) {
            await execute(escrow, signer, domain, bounty.bountyId, 0, 4, 0, bounty.creator, "0x0000000000000000000000000000000000000000", "UNBACKED_WINNER_REFUND");
            continue;
          }
        }

        for (const attempt of bounty.attempts) {
          const baseAttempt = await escrow.attempts(bounty.bountyId, attempt.attemptIndex);
          if (baseAttempt.challenger === "0x0000000000000000000000000000000000000000" || baseAttempt.settled) continue;
          let outcome = 0; let payout = 0; let recipient = "";
          if (attempt.statusLabel === "WON") { outcome = 1; payout = attempt.lastPayoutBps || 10_000; recipient = attempt.challenger; }
          else if (["LOST_RACE", "CANCELLED", "INSUFFICIENT_EVIDENCE_FINAL"].includes(attempt.statusLabel)) { outcome = 2; recipient = attempt.challenger; }
          else if (attempt.statusLabel === "BOND_FORFEITED") { outcome = 3; recipient = bounty.creator; }
          if (!outcome) continue;
          const appealRecipient = baseAttempt.appealBond > 0n ? attempt.appealBondRecipient : "0x0000000000000000000000000000000000000000";
          await execute(escrow, signer, domain, bounty.bountyId, attempt.attemptIndex, outcome, payout, recipient, appealRecipient, `${attempt.statusLabel}:${attempt.lastVerdict}`);
        }
      } catch (err) {
        logger.error({ bountyId: bounty.bountyId, err }, "base relay: bounty sweep failed");
      }
    }
  } finally { running = false; }
}

async function execute(escrow: Contract, signer: Wallet, domain: Record<string, unknown>, bountyId: number, attemptIndex: number, outcome: number, payoutBps: number, recipient: string, appealRecipient: string, state: string) {
  const decisionHash = keccak256(solidityPacked(["address", "uint256", "uint256", "string"], [env.PROOFBOUNTY_CONTRACT_ADDRESS, bountyId, attemptIndex, state]));
  const authorization = await signer.signTypedData(domain, {
    Settle: [
      { name: "bountyId", type: "uint256" }, { name: "attemptIndex", type: "uint256" },
      { name: "outcome", type: "uint8" }, { name: "payoutBps", type: "uint16" },
      { name: "recipient", type: "address" }, { name: "appealRecipient", type: "address" },
      { name: "decisionHash", type: "bytes32" },
    ],
  }, { bountyId, attemptIndex, outcome, payoutBps, recipient, appealRecipient, decisionHash });
  await (await escrow.executeDecision(bountyId, attemptIndex, outcome, payoutBps, recipient, appealRecipient, decisionHash, authorization)).wait();
}

export function startBaseRelayer(logger: Logger) {
  if (!configured()) { logger.info({}, "base relay: disabled (configuration incomplete)"); return null; }
  void relayBaseOnce(logger);
  return setInterval(() => void relayBaseOnce(logger), env.BASE_RELAY_INTERVAL_MS);
}
