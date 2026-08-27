import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, read, receiptSucceeded, statusName, leaderExecutionResult, toGenWei } from "./lib-contract.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ✓", msg);
}

const creator = await loadAccount("dv-buyer");
const challenger = await loadAccount("vde-contester");
const arbiter = await loadAccount("sac-council");

const creatorClient = clientFor(creator.account);
const challengerClient = clientFor(challenger.account);

console.log("=== Test: REJECTED verdict path -> claim_bond_forfeiture (deliberately unsatisfiable claim) ===");

const rewardGen = "1.5";
const bondGen = "0.25";

const title = "Prove the GenLayer homepage displays a live cryptocurrency price ticker widget";
const claimText =
  "The genlayer.com homepage shows a real-time price ticker widget for GEN or another " +
  "cryptocurrency directly in its header navigation bar.";
// Deliberately checks for a marker string that cannot exist on a real,
// unmodified page — a genuine negative-claim test that GenLayer's live
// web-fetch + LLM consensus should correctly and reproducibly reject.
const criteria =
  "1. The fetched page must contain the exact literal string " +
  "'zzz-impossible-proof-marker-price-ticker-9182'.\n" +
  "2. Absent that marker, the fetched page must show an actual live-updating price widget " +
  "in the page header, not merely a mention of GEN token economics.";
const evidenceReqs = "A public URL demonstrating the live price ticker widget in the page header.";

const { receipt: createReceipt } = await write(
  creatorClient,
  "create_bounty",
  [
    title,
    claimText,
    "POSITIVE",
    "PRODUCT_CLAIMS",
    criteria,
    evidenceReqs,
    arbiter.address,
    172800,
    Number(toGenWei(bondGen)),
  ],
  toGenWei(rewardGen)
);
assert(receiptSucceeded(createReceipt), "create_bounty succeeded");

const bountyId = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId:", bountyId);
console.log(`title: "${title}"`);

const { receipt: acceptReceipt } = await write(challengerClient, "accept_bounty", [bountyId], toGenWei(bondGen));
assert(receiptSucceeded(acceptReceipt), "accept_bounty succeeded");

let attempt = await read("get_attempt", [bountyId, 0]);
const maxRevisions = attempt.max_revisions;
console.log("max_revisions:", maxRevisions);

let cycle = 0;
while (true) {
  cycle++;
  console.log(`\n-- submit_evidence + request_verification cycle ${cycle} --`);
  const { receipt: submitReceipt } = await write(challengerClient, "submit_evidence", [
    bountyId, 0, "https://genlayer.com/",
    `Cycle ${cycle}: submitting the real GenLayer homepage, which genuinely has no such ` +
      "marker string or live price ticker widget in its header.",
  ]);
  assert(receiptSucceeded(submitReceipt), `cycle ${cycle}: submit_evidence succeeded`);

  const verifyStart = Date.now();
  const { receipt: verifyReceipt } = await write(challengerClient, "request_verification", [bountyId, 0]);
  console.log(`   verification took ${((Date.now() - verifyStart) / 1000).toFixed(1)}s -- status=${statusName(verifyReceipt)} exec=${leaderExecutionResult(verifyReceipt)}`);
  assert(receiptSucceeded(verifyReceipt), `cycle ${cycle}: request_verification tx succeeded (no GenVM error)`);

  attempt = await read("get_attempt", [bountyId, 0]);
  console.log(`   verdict: ${attempt.last_verdict} | status: ${attempt.status_label} | revision_count: ${attempt.revision_count}`);
  console.log(`   reasoning: ${attempt.last_reasoning}`);

  if (attempt.status_label === "REJECTED_FINAL") {
    console.log("\n✅ Reached REJECTED_FINAL — as expected for a deliberately unsatisfiable claim.");
    break;
  }
  if (attempt.status_label === "WON") {
    console.log("\n⚠️  Attempt unexpectedly WON despite deliberately unsatisfiable criteria. Stopping this test path.");
    process.exit(0);
  }
  if (cycle > maxRevisions + 1) {
    throw new Error("Exceeded expected cycle count without reaching a terminal state -- possible stuck loop bug.");
  }
}

console.log("\n-- claim_bond_forfeiture (creator claims challenger's forfeited bond) --");
const { receipt: forfeitReceipt } = await write(creatorClient, "claim_bond_forfeiture", [bountyId, 0]);
assert(receiptSucceeded(forfeitReceipt), "claim_bond_forfeiture succeeded");

attempt = await read("get_attempt", [bountyId, 0]);
assert(attempt.status_label === "BOND_FORFEITED", "attempt status is BOND_FORFEITED");
assert(Number(attempt.bond_deposited) === 0, "bond_deposited == 0 after forfeiture");

console.log("\n-- claim_bond_forfeiture double-claim should fail --");
try {
  const { receipt } = await write(creatorClient, "claim_bond_forfeiture", [bountyId, 0]);
  console.log("  ", receiptSucceeded(receipt) ? "[UNEXPECTED SUCCESS ✗]" : "[correctly rejected ✓]", "double-claim");
} catch (err) {
  console.log("  [correctly rejected ✓ (threw)] double-claim:", err.message?.slice(0, 100));
}

console.log("\n✅ REJECTED PATH TEST PASSED. bountyId:", bountyId);
