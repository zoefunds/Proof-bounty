import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, receiptSucceeded, statusName, leaderExecutionResult, toGenWei } from "./lib-contract.mjs";

const creator = await loadAccount("dv-buyer");
const client = clientFor(creator.account);
const ZERO = "0x0000000000000000000000000000000000000000";

// Real-world-style bounty premise reused across every negative test below,
// matching the kind of claim PROOFBOUNTY.md's own examples describe
// (protocol-research category, a specific verifiable technical claim).
const TITLE = "Prove GenLayer's Optimistic Democracy consensus model is documented publicly";
const CLAIM =
  "GenLayer's own developer documentation publicly describes the Optimistic Democracy " +
  "consensus mechanism used by GenVM validators, including the leader-proposes / " +
  "validators-vote / appeal-window structure.";
const CRITERIA =
  "1. The fetched page must explicitly name 'Optimistic Democracy' as GenLayer's consensus model.\n" +
  "2. The fetched page must describe validators voting on a leader's proposed result.\n" +
  "3. The fetched page must be hosted on a genlayer.com or docs.genlayer.com domain.";
const EVIDENCE_REQS = "A public URL on GenLayer's own documentation site.";

async function expectFail(label, fn) {
  try {
    const { receipt } = await fn();
    const ok = receiptSucceeded(receipt);
    const name = statusName(receipt);
    const execResult = leaderExecutionResult(receipt);
    console.log(
      `[${ok ? "UNEXPECTED SUCCESS ✗" : "correctly rejected ✓"}] ${label} -- status=${name} exec=${execResult}`
    );
  } catch (err) {
    console.log(`[correctly rejected ✓ (threw)] ${label}:`, err.message?.slice(0, 150));
  }
}

console.log("=== create_bounty validation failures (all should be rejected) ===");
console.log(`Base premise: "${TITLE}"\n`);

await expectFail("zero-address arbiter", () =>
  write(client, "create_bounty", [
    TITLE, CLAIM, "POSITIVE", "PROTOCOL_RESEARCH", CRITERIA, EVIDENCE_REQS, ZERO, 172800, 0,
  ], toGenWei("1"))
);

await expectFail("deadline below minimum (60s, needs >= 3600s)", () =>
  write(client, "create_bounty", [
    TITLE, CLAIM, "POSITIVE", "PROTOCOL_RESEARCH", CRITERIA, EVIDENCE_REQS, creator.address, 60, 0,
  ], toGenWei("1"))
);

await expectFail("zero reward (no GEN value sent)", () =>
  write(client, "create_bounty", [
    TITLE, CLAIM, "POSITIVE", "PROTOCOL_RESEARCH", CRITERIA, EVIDENCE_REQS, creator.address, 172800, 0,
  ], 0n)
);

await expectFail("invalid category ('CRYPTOCURRENCY' is not in the fixed enum)", () =>
  write(client, "create_bounty", [
    TITLE, CLAIM, "POSITIVE", "CRYPTOCURRENCY", CRITERIA, EVIDENCE_REQS, creator.address, 172800, 0,
  ], toGenWei("1"))
);

await expectFail("empty title", () =>
  write(client, "create_bounty", [
    "", CLAIM, "POSITIVE", "PROTOCOL_RESEARCH", CRITERIA, EVIDENCE_REQS, creator.address, 172800, 0,
  ], toGenWei("1"))
);

await expectFail("empty proof_criteria", () =>
  write(client, "create_bounty", [
    TITLE, CLAIM, "POSITIVE", "PROTOCOL_RESEARCH", "", EVIDENCE_REQS, creator.address, 172800, 0,
  ], toGenWei("1"))
);

await expectFail("invalid claim_polarity ('MAYBE' instead of POSITIVE/NEGATIVE)", () =>
  write(client, "create_bounty", [
    TITLE, CLAIM, "MAYBE", "PROTOCOL_RESEARCH", CRITERIA, EVIDENCE_REQS, creator.address, 172800, 0,
  ], toGenWei("1"))
);

await expectFail("negative required_bond", () =>
  write(client, "create_bounty", [
    TITLE, CLAIM, "POSITIVE", "PROTOCOL_RESEARCH", CRITERIA, EVIDENCE_REQS, creator.address, 172800, -1,
  ], toGenWei("1"))
);

console.log("\nDone.");
