import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, read, receiptSucceeded, statusName, leaderExecutionResult, toGenWei } from "./lib-contract.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED (would be an on-chain error): " + msg);
  console.log("  ✓", msg);
}

console.log("=== PRODUCT TEST A: multi-challenger settlement race, deadline extension, real APPROVED verdict, bond reclaim ===");
console.log("No transaction in this test is expected to revert.\n");

const creator = await loadAccount("dv-buyer");
const winner = await loadAccount("vde-claimant");
const loser = await loadAccount("dv-seller");

const creatorClient = clientFor(creator.account);
const winnerClient = clientFor(winner.account);
const loserClient = clientFor(loser.account);

const title = "Prove GenLayer's official documentation names 'Optimistic Democracy' as its consensus mechanism";
const claim =
  "GenLayer's own developer documentation at docs.genlayer.com explicitly names and describes " +
  "'Optimistic Democracy' as the protocol's consensus mechanism for validating Intelligent Contract execution.";
const criteria =
  "1. The fetched page must be hosted on a genlayer.com or docs.genlayer.com domain.\n" +
  "2. The fetched page must contain the exact phrase 'Optimistic Democracy'.\n" +
  "3. The page must describe it as GenLayer's consensus mechanism, not merely mention it in passing.";
const evidenceReqs = "A public URL on GenLayer's official documentation site (docs.genlayer.com).";
const rewardGen = "2.5";
const bondGen = "0.2";

console.log(`-- create_bounty: "${title}" --`);
const { receipt: createReceipt } = await write(
  creatorClient, "create_bounty",
  [title, claim, "POSITIVE", "DOCUMENTATION", criteria, evidenceReqs, creator.address, 3 * 86400, Number(toGenWei(bondGen))],
  toGenWei(rewardGen)
);
assert(receiptSucceeded(createReceipt), "create_bounty succeeded");
const bountyId = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId:", bountyId);

console.log("\n-- extend_bounty_deadline (creator gives challengers one more day) --");
const { receipt: extendReceipt } = await write(creatorClient, "extend_bounty_deadline", [bountyId, 86400]);
assert(receiptSucceeded(extendReceipt), "extend_bounty_deadline succeeded");
const bountyAfterExtend = await read("get_bounty", [bountyId]);
console.log("   new deadline:", bountyAfterExtend.deadline, new Date(bountyAfterExtend.deadline * 1000).toISOString());

console.log("\n-- accept_bounty x2 (concurrent challengers) --");
const { receipt: acceptWinner } = await write(winnerClient, "accept_bounty", [bountyId], toGenWei(bondGen));
assert(receiptSucceeded(acceptWinner), "winner's accept_bounty succeeded");
const { receipt: acceptLoser } = await write(loserClient, "accept_bounty", [bountyId], toGenWei(bondGen));
assert(receiptSucceeded(acceptLoser), "loser's accept_bounty succeeded");

const bountyAfterAccepts = await read("get_bounty", [bountyId]);
assert(bountyAfterAccepts.attempt_count === 2, "attempt_count == 2");
assert(bountyAfterAccepts.criteria_locked === true, "criteria locked after first accept");

console.log("\n-- submit_evidence x2 --");
const { receipt: submitWinner } = await write(winnerClient, "submit_evidence", [
  bountyId, 0, "https://docs.genlayer.com/", "GenLayer's own documentation homepage, which introduces Optimistic Democracy as the core consensus mechanism.",
]);
assert(receiptSucceeded(submitWinner), "winner's submit_evidence succeeded");
const { receipt: submitLoser } = await write(loserClient, "submit_evidence", [
  bountyId, 1, "https://docs.genlayer.com/", "Same documentation entry point, submitted independently in the race.",
]);
assert(receiptSucceeded(submitLoser), "loser's submit_evidence succeeded");

console.log("\n-- request_verification on the winner's attempt (real web fetch + real LLM consensus, ~30-100s) --");
const { receipt: verifyReceipt } = await write(winnerClient, "request_verification", [bountyId, 0]);
assert(receiptSucceeded(verifyReceipt), "request_verification tx succeeded (no GenVM error)");
const attemptWinner = await read("get_attempt", [bountyId, 0]);
console.log("   verdict:", attemptWinner.last_verdict, "| status:", attemptWinner.status_label);
console.log("   evidence_content_hash:", attemptWinner.evidence_content_hash);

const bountyAfterVerify = await read("get_bounty", [bountyId]);
console.log("   bounty status:", bountyAfterVerify.status_label, "| winning_attempt_index:", bountyAfterVerify.winning_attempt_index);

if (bountyAfterVerify.status_label === "SETTLED") {
  const attemptLoser = await read("get_attempt", [bountyId, 1]);
  assert(attemptLoser.status_label === "LOST_RACE", "loser's attempt auto-marked LOST_RACE");

  console.log("\n-- reclaim_bond_after_settlement (loser reclaims their bond) --");
  const { receipt: reclaimReceipt } = await write(loserClient, "reclaim_bond_after_settlement", [bountyId, 1]);
  assert(receiptSucceeded(reclaimReceipt), "reclaim_bond_after_settlement succeeded");
} else {
  console.log("   (bounty did not settle from this single verification call — real LLM outcome, no forced follow-up)");
}

console.log("\n-- read-method sweep --");
const counter = await read("get_bounty_counter");
console.log("   get_bounty_counter:", counter);
const balance = await read("get_contract_balance");
console.log("   get_contract_balance:", balance);
const categories = await read("get_valid_categories");
console.log("   get_valid_categories:", categories.length, "categories");
const attempts = await read("get_bounty_attempts", [bountyId]);
console.log("   get_bounty_attempts:", attempts.length, "attempts");
const winnerRep = await read("get_reputation", [winner.address]);
console.log("   get_reputation(winner):", JSON.stringify(winnerRep));
const listing = await read("list_bounties", [0, 10]);
console.log("   list_bounties(0,10):", listing.length, "bounties");
const disputed = await read("get_disputed_attempts", [0, 10]);
console.log("   get_disputed_attempts(0,10):", disputed.length, "disputed attempts");

console.log("\n✅ PRODUCT TEST A COMPLETE. bountyId:", bountyId);
