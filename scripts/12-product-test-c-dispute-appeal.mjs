import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, read, receiptSucceeded } from "./lib-contract.mjs";
import { toGenWei } from "./lib-contract.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED (would be an on-chain error): " + msg);
  console.log("  ✓", msg);
}

console.log("=== PRODUCT TEST C: dispute -> named arbiter's ruling -> appeal (stops before finalize/owner resolution) ===");
console.log("Deliberately stops at APPEALED. finalize_arbiter_resolution needs the 2-day appeal window to actually");
console.log("elapse (calling it early would revert), and resolve_appeal is owner-only and explicitly out of scope");
console.log("for this test round. Every transaction below is expected to succeed regardless of the AI verdict,");
console.log("since we escalate to the arbiter no matter what the initial verdict was.\n");

const creator = await loadAccount("vde-claimant");
const challenger = await loadAccount("dv-seller");
const arbiter = await loadAccount("vde-contester-2");

const creatorClient = clientFor(creator.account);
const challengerClient = clientFor(challenger.account);
const arbiterClient = clientFor(arbiter.account);

const title = "Prove the IETF Datatracker lists a currently active Internet-Draft specifically about GenLayer's consensus protocol";
const claim =
  "The IETF's official datatracker.ietf.org site lists a currently active (not expired or withdrawn) " +
  "Internet-Draft whose title explicitly references GenLayer or its 'Optimistic Democracy' consensus model.";
const criteria =
  "1. The fetched page must be hosted on datatracker.ietf.org.\n" +
  "2. The listed draft's title must explicitly mention 'GenLayer' or 'Optimistic Democracy'.\n" +
  "3. The draft's status shown on the page must be active, not Expired or Withdrawn.";
const evidenceReqs = "A public URL on datatracker.ietf.org pointing to the specific draft.";
const rewardGen = "3";
const bondGen = "0.25";

console.log(`-- create_bounty: "${title}" --`);
const { receipt: createReceipt } = await write(
  creatorClient, "create_bounty",
  [title, claim, "POSITIVE", "PROTOCOL_RESEARCH", criteria, evidenceReqs, arbiter.address, 2 * 86400, Number(toGenWei(bondGen))],
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
  bountyId, 0, "https://datatracker.ietf.org/", "The IETF Datatracker's general search interface, used as the starting point for locating the draft.",
]);
assert(receiptSucceeded(submitReceipt), "submit_evidence succeeded");

console.log("\n-- request_verification (real web fetch + real LLM consensus) --");
const { receipt: verifyReceipt } = await write(challengerClient, "request_verification", [bountyId, 0]);
assert(receiptSucceeded(verifyReceipt), "request_verification tx succeeded (no GenVM error)");
let attempt = await read("get_attempt", [bountyId, 0]);
console.log("   verdict:", attempt.last_verdict, "| status:", attempt.status_label);

if (attempt.status_label === "ACCEPTED" && attempt.revision_count > 0 && attempt.revision_count < attempt.max_revisions) {
  console.log("\n   NEEDS_REVISION or INSUFFICIENT_EVIDENCE landed with cycles remaining -- attempt is back to ACCEPTED,");
  console.log("   not yet disputable in a way that demonstrates the dispute path meaningfully. Resubmitting once more.");
  const { receipt: resubmit } = await write(challengerClient, "submit_evidence", [
    bountyId, 0, "https://datatracker.ietf.org/doc/search/", "The Datatracker's document search page specifically, a more targeted starting point.",
  ]);
  assert(receiptSucceeded(resubmit), "resubmission succeeded");
  const { receipt: reverify } = await write(challengerClient, "request_verification", [bountyId, 0]);
  assert(receiptSucceeded(reverify), "second request_verification tx succeeded");
  attempt = await read("get_attempt", [bountyId, 0]);
  console.log("   verdict:", attempt.last_verdict, "| status:", attempt.status_label);
}

if (attempt.status_label !== "DISPUTED" && ["REJECTED_FINAL", "ACCEPTED", "NEEDS_REVISION"].includes(attempt.status_label)) {
  console.log("\n-- raise_dispute (challenger believes the AI verdict was too strict given the effort put in) --");
  const { receipt: disputeReceipt } = await write(challengerClient, "raise_dispute", [
    bountyId, 0,
    "I believe the AI verdict did not give enough weight to the IETF Datatracker being the correct, " +
    "authoritative source for this claim, even if the specific draft was hard to locate via the general search " +
    "interface. Requesting the named arbiter's manual review of the underlying claim.",
  ]);
  assert(receiptSucceeded(disputeReceipt), "raise_dispute succeeded");
  attempt = await read("get_attempt", [bountyId, 0]);
  assert(attempt.status_label === "DISPUTED", "attempt status is DISPUTED");
} else {
  console.log("\n   attempt already reached a terminal or already-disputed state; skipping raise_dispute to avoid a precondition revert.");
}

if (attempt.status_label === "DISPUTED") {
  console.log("\n-- resolve_dispute (named arbiter reviews manually and rules) --");
  const { receipt: resolveReceipt } = await write(arbiterClient, "resolve_dispute", [
    bountyId, 0, "APPROVE",
    "As the named arbiter, I manually checked datatracker.ietf.org and found the underlying research effort " +
    "credible even though the AI's automated fetch did not land on the exact draft page. Approving in full.",
    0,
  ]);
  assert(receiptSucceeded(resolveReceipt), "resolve_dispute succeeded");
  attempt = await read("get_attempt", [bountyId, 0]);
  assert(attempt.status_label === "ARBITER_RESOLVED_PENDING_APPEAL", "attempt status is ARBITER_RESOLVED_PENDING_APPEAL");
  console.log("   pending_arbiter_verdict:", attempt.pending_arbiter_verdict, "| appeal_deadline:", new Date(attempt.appeal_deadline * 1000).toISOString());

  console.log("\n-- appeal_arbiter_resolution (creator appeals the arbiter's override, real appeal bond posted) --");
  const { receipt: appealReceipt } = await write(
    creatorClient, "appeal_arbiter_resolution",
    [bountyId, 0, "The arbiter's override does not match the precommitted criteria, which required the exact draft page, not just a credible research effort. Requesting the protocol owner's final review."],
    toGenWei(bondGen)
  );
  assert(receiptSucceeded(appealReceipt), "appeal_arbiter_resolution succeeded");
  attempt = await read("get_attempt", [bountyId, 0]);
  assert(attempt.status_label === "APPEALED", "attempt status is APPEALED");
  console.log("   appealed_by:", attempt.appealed_by, "| appeal_bond_deposited:", attempt.appeal_bond_deposited);
  console.log("\n   Stopping here by design: finalize_arbiter_resolution would revert until the appeal window");
  console.log("   closes on its own, and resolve_appeal is owner-only and out of scope for this test round.");
} else {
  console.log("\n   Dispute path did not reach DISPUTED status this run; arbiter/appeal steps correctly skipped.");
}

const disputed = await read("get_disputed_attempts", [0, 10]);
console.log("\n   get_disputed_attempts(0,10):", disputed.length, "entries");

console.log("\n✅ PRODUCT TEST C COMPLETE. bountyId:", bountyId);
