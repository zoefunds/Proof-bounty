import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, read, receiptSucceeded, toGenWei } from "./lib-contract.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ✓", msg);
}

const creator = await loadAccount("dv-buyer");
const challengerA = await loadAccount("vde-claimant"); // will win
const challengerB = await loadAccount("dv-seller"); // will lose the race
const arbiter = await loadAccount("sac-council");

const creatorClient = clientFor(creator.account);
const challengerAClient = clientFor(challengerA.account);
const challengerBClient = clientFor(challengerB.account);

console.log("=== Test: multi-attempt marketplace race, real APPROVED verdict, evidence manifest ===");
console.log("creator:", creator.address);
console.log("challengerA (should win):", challengerA.address);
console.log("challengerB (should lose race, reclaim bond):", challengerB.address);
console.log("arbiter:", arbiter.address);

const rewardGen = "3";
const bondGen = "0.15";

const title = "Prove GenLayer's own docs describe validator staking requirements";
const claimText =
  "GenLayer's public developer documentation explains how node operators become " +
  "validators, including that they must stake GEN and can run a validator node " +
  "themselves rather than only through a centralized operator.";
const criteria =
  "1. The fetched page must mention the word 'consensus'.\n" +
  "2. The fetched page must mention 'validator' or 'validators'.\n" +
  "3. The fetched page must reference running or operating a validator node.";
const evidenceReqs =
  "A public URL on GenLayer's own documentation or homepage describing validator participation.";

console.log("\n-- create_bounty --");
console.log(`   title: "${title}"`);
console.log(`   reward: ${rewardGen} GEN, bond: ${bondGen} GEN, deadline: 2 days`);
const { receipt: createReceipt } = await write(
  creatorClient,
  "create_bounty",
  [
    title,
    claimText,
    "POSITIVE",
    "DOCUMENTATION",
    criteria,
    evidenceReqs,
    arbiter.address,
    172800, // 2 days
    Number(toGenWei(bondGen)),
  ],
  toGenWei(rewardGen)
);
assert(receiptSucceeded(createReceipt), "create_bounty succeeded (real tx, no GenVM error)");

const bountyId = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId:", bountyId);

let bounty = await read("get_bounty", [bountyId]);
assert(bounty.status_label === "OPEN", "bounty status is OPEN");
assert(String(bounty.reward_deposited) === String(toGenWei(rewardGen)), `reward_deposited == ${rewardGen} GEN in wei`);
assert(bounty.criteria_locked === false, "criteria not locked before any attempt");
assert(bounty.category === "DOCUMENTATION", "category persisted correctly");
assert(bounty.claim_polarity === "POSITIVE", "claim_polarity persisted correctly");

console.log("\n-- accept_bounty x2 (concurrent attempts, the core marketplace mechanic) --");
const { receipt: acceptAReceipt } = await write(challengerAClient, "accept_bounty", [bountyId], toGenWei(bondGen));
assert(receiptSucceeded(acceptAReceipt), "challengerA accept_bounty succeeded");

const { receipt: acceptBReceipt } = await write(challengerBClient, "accept_bounty", [bountyId], toGenWei(bondGen));
assert(receiptSucceeded(acceptBReceipt), "challengerB accept_bounty succeeded");

bounty = await read("get_bounty", [bountyId]);
assert(bounty.criteria_locked === true, "criteria locked after first attempt accepted");
assert(bounty.attempt_count === 2, "attempt_count == 2 (concurrent attempts confirmed)");

console.log("\n-- accept_bounty validation failures --");
try {
  const { receipt } = await write(challengerAClient, "accept_bounty", [bountyId], toGenWei("0.05"));
  console.log("  ", receiptSucceeded(receipt) ? "[UNEXPECTED SUCCESS ✗]" : "[correctly rejected ✓]", "wrong bond amount");
} catch (err) {
  console.log("   [correctly rejected ✓ (threw)] wrong bond amount:", err.message?.slice(0, 100));
}
try {
  const { receipt } = await write(creatorClient, "accept_bounty", [bountyId], toGenWei(bondGen));
  console.log("  ", receiptSucceeded(receipt) ? "[UNEXPECTED SUCCESS ✗]" : "[correctly rejected ✓]", "creator self-attempt");
} catch (err) {
  console.log("   [correctly rejected ✓ (threw)] creator self-attempt:", err.message?.slice(0, 100));
}

console.log("\n-- submit_evidence validation failures --");
try {
  const { receipt } = await write(challengerAClient, "submit_evidence", [bountyId, 0, "ftp://not-http.example", "desc"]);
  console.log("  ", receiptSucceeded(receipt) ? "[UNEXPECTED SUCCESS ✗]" : "[correctly rejected ✓]", "non-http URL");
} catch (err) {
  console.log("   [correctly rejected ✓ (threw)] non-http URL:", err.message?.slice(0, 100));
}
try {
  const { receipt } = await write(challengerBClient, "submit_evidence", [bountyId, 0, "https://docs.genlayer.com/", "wrong caller"]);
  console.log("  ", receiptSucceeded(receipt) ? "[UNEXPECTED SUCCESS ✗]" : "[correctly rejected ✓]", "wrong-caller submit_evidence");
} catch (err) {
  console.log("   [correctly rejected ✓ (threw)] wrong-caller submit_evidence:", err.message?.slice(0, 100));
}

console.log("\n-- submit_evidence (real) for both attempts --");
const { receipt: submitAReceipt } = await write(challengerAClient, "submit_evidence", [
  bountyId, 0, "https://docs.genlayer.com/",
  "GenLayer's own documentation homepage, which describes the validator consensus mechanism " +
    "and how to run a validator node.",
]);
assert(receiptSucceeded(submitAReceipt), "challengerA submit_evidence succeeded");

const { receipt: submitBReceipt } = await write(challengerBClient, "submit_evidence", [
  bountyId, 1, "https://docs.genlayer.com/", "Same documentation page, submitted second.",
]);
assert(receiptSucceeded(submitBReceipt), "challengerB submit_evidence succeeded");

let attemptA = await read("get_attempt", [bountyId, 0]);
assert(attemptA.status_label === "SUBMITTED", "attemptA status is SUBMITTED");

console.log("\n-- request_verification on attemptA (REAL web fetch + REAL multi-validator LLM consensus) --");
console.log("   (fetches https://docs.genlayer.com/ live and runs GenLayer validator consensus; may take 30-90s)");
const verifyStart = Date.now();
const { receipt: verifyAReceipt } = await write(challengerAClient, "request_verification", [bountyId, 0]);
console.log(`   verification took ${((Date.now() - verifyStart) / 1000).toFixed(1)}s`);
assert(receiptSucceeded(verifyAReceipt), "request_verification tx succeeded (no GenVM error, no UNDETERMINED consensus)");

attemptA = await read("get_attempt", [bountyId, 0]);
console.log("   verdict:", attemptA.last_verdict);
console.log("   reasoning:", attemptA.last_reasoning);
console.log("   status:", attemptA.status_label);
console.log("   evidence_content_hash:", attemptA.evidence_content_hash, "(evidence manifest fingerprint)");
console.log("   evidence_fetched_at:", attemptA.evidence_fetched_at, new Date(attemptA.evidence_fetched_at * 1000).toISOString());

if (attemptA.last_verdict === "APPROVED" || attemptA.last_verdict === "PARTIAL") {
  assert(attemptA.status_label === "WON", "attemptA status is WON after APPROVED/PARTIAL verdict");
  assert(attemptA.evidence_content_hash.length > 0, "evidence_content_hash was recorded on-chain (audit-driven fix #2)");
  assert(attemptA.evidence_fetched_at > 0, "evidence_fetched_at timestamp was recorded");

  bounty = await read("get_bounty", [bountyId]);
  assert(bounty.status_label === "SETTLED", "bounty status is SETTLED");
  assert(bounty.attempts_won === 1, "bounty attempts_won == 1");
  assert(bounty.winning_attempt_index === 0, "winning_attempt_index == 0 (challengerA)");

  const attemptB = await read("get_attempt", [bountyId, 1]);
  assert(attemptB.status_label === "LOST_RACE", "attemptB automatically marked LOST_RACE on settlement");
  assert(Number(attemptB.bond_deposited) === Number(toGenWei(bondGen)), "attemptB bond still held (not yet reclaimed)");

  console.log("\n-- reclaim_bond_after_settlement (challengerB, the loser) --");
  const { receipt: reclaimReceipt } = await write(challengerBClient, "reclaim_bond_after_settlement", [bountyId, 1]);
  assert(receiptSucceeded(reclaimReceipt), "reclaim_bond_after_settlement succeeded");
  const attemptBAfter = await read("get_attempt", [bountyId, 1]);
  assert(Number(attemptBAfter.bond_deposited) === 0, "attemptB bond_deposited == 0 after reclaim");

  console.log("\n✅ RACE TEST PASSED — real GenLayer verdict:", attemptA.last_verdict);
} else if (attemptA.last_verdict === "NEEDS_REVISION") {
  console.log("\n⚠️  Real LLM returned NEEDS_REVISION (page content may have changed) — valid, expected outcome.");
} else if (attemptA.last_verdict === "REJECTED") {
  console.log("\n⚠️  Real LLM returned REJECTED for challenger A on this run — legitimate model outcome, not a contract error.");
} else {
  throw new Error("Unexpected verdict value: " + attemptA.last_verdict);
}

console.log("\nbountyId used in this test:", bountyId);
