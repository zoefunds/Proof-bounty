import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, read, receiptSucceeded } from "./lib-contract.mjs";
import { toGenWei } from "./lib-contract.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED (would be an on-chain error): " + msg);
  console.log("  ✓", msg);
}

console.log("=== PRODUCT TEST D: clean cancel_bounty, plus a genuine PARTIAL-shaped verification ===\n");

const creatorD1 = await loadAccount("vde-contester-2");
const creatorD2 = await loadAccount("dv-seller");
const challengerD2 = await loadAccount("sac-council");

const creatorD1Client = clientFor(creatorD1.account);
const creatorD2Client = clientFor(creatorD2.account);
const challengerD2Client = clientFor(challengerD2.account);

console.log("--- D1: create_bounty -> cancel_bounty (no attempts, creator changes their mind) ---");
const titleD1 = "Prove the W3C's WCAG 2.2 specification lists at least 10 distinct success criteria under the Perceivable principle";
const claimD1 =
  "The W3C's official WCAG 2.2 specification page lists at least 10 distinct, individually-numbered success " +
  "criteria under the 'Perceivable' principle, each with its own direct anchor link.";
const criteriaD1 =
  "1. The fetched page must be hosted on w3.org.\n" +
  "2. At least 10 distinctly numbered success criteria must appear under a 'Perceivable' heading.\n" +
  "3. Each must have its own anchor/identifier, not be a single combined bullet list.";
const evidenceReqsD1 = "A public URL on w3.org pointing to the WCAG 2.2 specification.";

const { receipt: createD1 } = await write(
  creatorD1Client, "create_bounty",
  [titleD1, claimD1, "POSITIVE", "DOCUMENTATION", criteriaD1, evidenceReqsD1, creatorD1.address, 86400, 0],
  toGenWei("1")
);
assert(receiptSucceeded(createD1), "create_bounty succeeded (D1)");
const bountyD1 = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId D1:", bountyD1);

const bountyD1Before = await read("get_bounty", [bountyD1]);
assert(bountyD1Before.criteria_locked === false, "criteria not locked, zero attempts -- safe to cancel");

console.log("\n-- cancel_bounty (creator reconsiders before any challenger accepted) --");
const { receipt: cancelReceipt } = await write(creatorD1Client, "cancel_bounty", [bountyD1]);
assert(receiptSucceeded(cancelReceipt), "cancel_bounty succeeded");
const bountyD1After = await read("get_bounty", [bountyD1]);
assert(bountyD1After.status_label === "CANCELLED", "bounty status is CANCELLED");
assert(Number(bountyD1After.reward_deposited) === 0, "reward_deposited zeroed -- full refund to creator");

console.log("\n--- D2: a bounty shaped to plausibly draw a PARTIAL verdict (multi-part criteria, single page) ---");
const titleD2 = "Prove GenLayer's documentation covers both deploying an Intelligent Contract and running a validator node on one page";
const claimD2 =
  "GenLayer's official documentation has a single page that explains BOTH how to deploy an Intelligent Contract " +
  "AND how to run/operate a validator node, in the same document.";
const criteriaD2 =
  "1. The fetched page must be on docs.genlayer.com.\n" +
  "2. The page must explain how to deploy an Intelligent Contract.\n" +
  "3. The page must ALSO explain how to run or operate a validator node.\n" +
  "4. Both topics must appear substantively on the SAME fetched page, not merely link out to a separate page for one of them.";
const evidenceReqsD2 = "A public URL on docs.genlayer.com.";

const { receipt: createD2 } = await write(
  creatorD2Client, "create_bounty",
  [titleD2, claimD2, "POSITIVE", "DOCUMENTATION", criteriaD2, evidenceReqsD2, creatorD2.address, 86400, Number(toGenWei("0.15"))],
  toGenWei("2")
);
assert(receiptSucceeded(createD2), "create_bounty succeeded (D2)");
const bountyD2 = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId D2:", bountyD2);

const { receipt: acceptD2 } = await write(challengerD2Client, "accept_bounty", [bountyD2], toGenWei("0.15"));
assert(receiptSucceeded(acceptD2), "accept_bounty succeeded (D2)");

const { receipt: submitD2 } = await write(challengerD2Client, "submit_evidence", [
  bountyD2, 0, "https://docs.genlayer.com/", "GenLayer's documentation homepage, which links out to both the contract-deployment guide and the validator-operation guide.",
]);
assert(receiptSucceeded(submitD2), "submit_evidence succeeded (D2)");

console.log("\n-- request_verification (real web fetch + real LLM consensus) --");
const { receipt: verifyD2 } = await write(challengerD2Client, "request_verification", [bountyD2, 0]);
assert(receiptSucceeded(verifyD2), "request_verification tx succeeded (no GenVM error)");
const attemptD2 = await read("get_attempt", [bountyD2, 0]);
console.log("   verdict:", attemptD2.last_verdict, "| status:", attemptD2.status_label, "| payout_bps:", attemptD2.last_payout_bps);
console.log("   reasoning:", attemptD2.last_reasoning);

const repD2 = await read("get_reputation", [challengerD2.address]);
console.log("\n   get_reputation(challenger D2):", JSON.stringify(repD2));

console.log("\n-- final read-method sweep across the whole contract --");
const finalCounter = await read("get_bounty_counter");
console.log("   get_bounty_counter:", finalCounter);
const finalBalance = await read("get_contract_balance");
console.log("   get_contract_balance:", finalBalance);
const finalListing = await read("list_bounties", [0, 50]);
console.log("   list_bounties(0,50):", finalListing.length, "bounties total");
const attemptsD2 = await read("get_bounty_attempts", [bountyD2]);
console.log("   get_bounty_attempts(D2):", attemptsD2.length, "attempts");

console.log("\n✅ PRODUCT TEST D COMPLETE. bountyId D1:", bountyD1, "| bountyId D2:", bountyD2);
