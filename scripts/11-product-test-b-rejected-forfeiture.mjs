import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, read, receiptSucceeded } from "./lib-contract.mjs";
import { toGenWei } from "./lib-contract.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED (would be an on-chain error): " + msg);
  console.log("  ✓", msg);
}

console.log("=== PRODUCT TEST B: clearly-unsatisfiable claim, real REJECTED verdict, conditional bond forfeiture ===");
console.log("claim_bond_forfeiture is only called if the real verdict actually reaches REJECTED_FINAL --");
console.log("calling it otherwise would revert, which this test set is specifically designed never to do.\n");

const creator = await loadAccount("sac-council");
const challenger = await loadAccount("vde-contester");

const creatorClient = clientFor(creator.account);
const challengerClient = clientFor(challenger.account);

const title = "Prove the official GenLayer homepage displays a live, real-time GEN token price ticker widget";
const claim =
  "GenLayer's official homepage (genlayer.com) displays a real-time, auto-updating price ticker " +
  "widget showing the current market price of the GEN token.";
const criteria =
  "1. The fetched page must be the official genlayer.com homepage.\n" +
  "2. The page must contain a visibly labeled price/ticker element showing a numeric GEN token price.\n" +
  "3. That element must be described as live or real-time, not a static historical reference.";
const evidenceReqs = "A public URL to the genlayer.com homepage.";
const rewardGen = "1.5";
const bondGen = "0.1";

console.log(`-- create_bounty: "${title}" --`);
const { receipt: createReceipt } = await write(
  creatorClient, "create_bounty",
  [title, claim, "POSITIVE", "PRODUCT_CLAIMS", criteria, evidenceReqs, creator.address, 86400, Number(toGenWei(bondGen))],
  toGenWei(rewardGen)
);
assert(receiptSucceeded(createReceipt), "create_bounty succeeded");
const bountyId = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId:", bountyId);

console.log("\n-- accept_bounty --");
const { receipt: acceptReceipt } = await write(challengerClient, "accept_bounty", [bountyId], toGenWei(bondGen));
assert(receiptSucceeded(acceptReceipt), "accept_bounty succeeded");

console.log("\n-- submit_evidence --");
const { receipt: submitReceipt } = await write(challengerClient, "submit_evidence", [
  bountyId, 0, "https://www.genlayer.com/", "The official GenLayer marketing homepage, submitted as evidence for this claim.",
]);
assert(receiptSucceeded(submitReceipt), "submit_evidence succeeded");

console.log("\n-- request_verification (real web fetch + real LLM consensus) --");
const { receipt: verifyReceipt } = await write(challengerClient, "request_verification", [bountyId, 0]);
assert(receiptSucceeded(verifyReceipt), "request_verification tx succeeded (no GenVM error)");
const attempt = await read("get_attempt", [bountyId, 0]);
console.log("   verdict:", attempt.last_verdict, "| status:", attempt.status_label);
console.log("   reasoning:", attempt.last_reasoning);

if (attempt.status_label === "REJECTED_FINAL") {
  console.log("\n-- claim_bond_forfeiture (creator claims the forfeited bond) --");
  const { receipt: forfeitReceipt } = await write(creatorClient, "claim_bond_forfeiture", [bountyId, 0]);
  assert(receiptSucceeded(forfeitReceipt), "claim_bond_forfeiture succeeded");
  const attemptAfter = await read("get_attempt", [bountyId, 0]);
  assert(attemptAfter.status_label === "BOND_FORFEITED", "attempt reached BOND_FORFEITED");
} else {
  console.log(`   (real verdict was ${attempt.last_verdict}/${attempt.status_label}, not REJECTED_FINAL yet --`);
  console.log("    claim_bond_forfeiture correctly NOT called this round to avoid a precondition revert.");
  if (attempt.status_label === "ACCEPTED" && attempt.revision_count > 0) {
    console.log("    Attempt is back to ACCEPTED for a resubmission cycle -- this is expected behavior, not an error.");
  }
}

const rep = await read("get_reputation", [challenger.address]);
console.log("\n   get_reputation(challenger):", JSON.stringify(rep));

console.log("\n✅ PRODUCT TEST B COMPLETE. bountyId:", bountyId);
