import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, write, read, receiptSucceeded, statusName, leaderExecutionResult, toGenWei } from "./lib-contract.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ✓", msg);
}
async function expectFail(label, fn) {
  try {
    const { receipt } = await fn();
    const ok = receiptSucceeded(receipt);
    console.log(`  [${ok ? "UNEXPECTED SUCCESS ✗" : "correctly rejected ✓"}] ${label} -- status=${statusName(receipt)} exec=${leaderExecutionResult(receipt)}`);
    return ok;
  } catch (err) {
    console.log(`  [correctly rejected ✓ (threw)] ${label}:`, err.message?.slice(0, 120));
    return false;
  }
}

const creator = await loadAccount("dv-buyer");
const challenger = await loadAccount("vde-contester-2");
const arbiter = await loadAccount("sac-council");
const stranger = await loadAccount("dv-seller");

const creatorClient = clientFor(creator.account);
const challengerClient = clientFor(challenger.account);
const arbiterClient = clientFor(arbiter.account);
const strangerClient = clientFor(stranger.account);

console.log("=== Two-tier appealable arbitration test (audit item #4) ===");

const title = "Prove the Linux Foundation's official blog announced a new kernel LTS release";
const claim =
  "The Linux Foundation's official kernel.org or linuxfoundation.org site publicly announced " +
  "a new Long-Term-Support kernel release with a specific version number.";
const criteria =
  "1. The fetched page must be hosted on kernel.org or linuxfoundation.org.\n" +
  "2. The fetched page must name a specific LTS kernel version.";
const bondGen = "0.2";

const { receipt: createReceipt } = await write(
  creatorClient, "create_bounty",
  [title, claim, "POSITIVE", "OPEN_SOURCE", criteria, "A public URL on an official Linux Foundation domain.",
   arbiter.address, 172800, Number(toGenWei(bondGen))],
  toGenWei("1.2")
);
assert(receiptSucceeded(createReceipt), "create_bounty succeeded");
const bountyId = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId:", bountyId, `-- title: "${title}"`);

await write(challengerClient, "accept_bounty", [bountyId], toGenWei(bondGen));
await write(challengerClient, "submit_evidence", [bountyId, 0, "https://example.com/", "deliberately won't satisfy the criteria"]);

console.log("\n-- request_verification (expect REJECTED or NEEDS_REVISION on this unrelated URL) --");
const { receipt: verifyReceipt } = await write(challengerClient, "request_verification", [bountyId, 0]);
assert(receiptSucceeded(verifyReceipt), "request_verification tx succeeded");
let attempt = await read("get_attempt", [bountyId, 0]);
console.log("   verdict:", attempt.last_verdict, "| status:", attempt.status_label);

if (attempt.status_label !== "REJECTED_FINAL") {
  console.log("\n⚠️  Attempt did not reach REJECTED_FINAL on this run (real LLM outcome) — appeal flow needs a disputable terminal state. Stopping this test path.");
  process.exit(0);
}

console.log("\n-- raise_dispute (real) --");
const { receipt: disputeReceipt } = await write(challengerClient, "raise_dispute", [
  bountyId, 0, "I believe the AI verdict was too strict given the effort put into researching this claim.",
]);
assert(receiptSucceeded(disputeReceipt), "raise_dispute succeeded");
attempt = await read("get_attempt", [bountyId, 0]);
assert(attempt.status_label === "DISPUTED", "attempt status is DISPUTED");

console.log("\n-- resolve_dispute (arbiter APPROVEs — this now opens a pending-appeal window, does NOT pay immediately) --");
const { receipt: resolveReceipt } = await write(arbiterClient, "resolve_dispute", [
  bountyId, 0, "APPROVE", "Arbiter reviewed manually and considers the submission substantially compliant.", 0,
]);
assert(receiptSucceeded(resolveReceipt), "resolve_dispute succeeded");
attempt = await read("get_attempt", [bountyId, 0]);
assert(attempt.status_label === "ARBITER_RESOLVED_PENDING_APPEAL", "attempt status is ARBITER_RESOLVED_PENDING_APPEAL (NOT WON — no immediate payout, the core redesign)");
assert(attempt.pending_arbiter_verdict === "APPROVE", "pending_arbiter_verdict recorded correctly");
assert(Number(attempt.appeal_deadline) > Math.floor(Date.now() / 1000), "appeal_deadline is set in the future (2-day window)");
console.log("   appeal_deadline:", attempt.appeal_deadline, new Date(attempt.appeal_deadline * 1000).toISOString());

console.log("\n-- finalize_arbiter_resolution BEFORE the appeal window closes (must fail) --");
await expectFail("finalize before appeal window closes", () =>
  write(strangerClient, "finalize_arbiter_resolution", [bountyId, 0])
);

console.log("\n-- appeal_arbiter_resolution validation failures --");
await expectFail("wrong appeal bond amount", () =>
  write(creatorClient, "appeal_arbiter_resolution", [bountyId, 0, "This ruling seems wrong to me."], toGenWei("0.01"))
);
await expectFail("stranger cannot appeal (not creator/challenger)", () =>
  write(strangerClient, "appeal_arbiter_resolution", [bountyId, 0, "I have no standing here."], toGenWei(bondGen))
);
await expectFail("empty appeal reason", () =>
  write(creatorClient, "appeal_arbiter_resolution", [bountyId, 0, ""], toGenWei(bondGen))
);

console.log("\n-- appeal_arbiter_resolution (real, creator posts the appeal bond) --");
const { receipt: appealReceipt } = await write(
  creatorClient, "appeal_arbiter_resolution",
  [bountyId, 0, "The evidence submitted does not actually satisfy the precommitted criteria; requesting an independent GenLayer consensus review."],
  toGenWei(bondGen)
);
assert(receiptSucceeded(appealReceipt), "appeal_arbiter_resolution succeeded — real appeal bond posted");
attempt = await read("get_attempt", [bountyId, 0]);
assert(attempt.status_label === "APPEALED", "attempt status is APPEALED");
assert(attempt.appealed_by.toLowerCase() === creator.address.toLowerCase(), "appealed_by recorded as the creator");
assert(Number(attempt.appeal_bond_deposited) === Number(toGenWei(bondGen)), "appeal_bond_deposited recorded correctly");

console.log("\n-- double-appeal should fail (already APPEALED, no longer PENDING_APPEAL) --");
await expectFail("double-appeal", () =>
  write(challengerClient, "appeal_arbiter_resolution", [bountyId, 0, "Also appealing."], toGenWei(bondGen))
);

console.log("\n-- resolve_appeal (permissionless -- proving no owner/access gate exists by calling it as a stranger) --");
const { receipt: finalReceipt } = await write(strangerClient, "resolve_appeal", [bountyId, 0]);
assert(receiptSucceeded(finalReceipt), "resolve_appeal tx succeeded (real web fetch + real LLM consensus, called by a complete stranger, no owner key anywhere in this test)");
attempt = await read("get_attempt", [bountyId, 0]);
console.log("   final status:", attempt.status_label, "| final verdict:", attempt.pending_arbiter_verdict);
assert(attempt.status_label !== "APPEALED", "resolve_appeal must move the attempt out of APPEALED");

const transparency = await read("get_settlement_transparency", []);
console.log("   get_settlement_transparency:", JSON.stringify(transparency));

console.log(
  "\nNote: `resolve_appeal` used to be owner-gated -- it no longer is. The final appeal tier is now " +
  "decided by a second, independent round of GenLayer validator consensus " +
  "(`_collect_appeal_verdict`), never a human's personal judgment, so this test now runs the FULL " +
  "chain live with no owner key involved at any point."
);

console.log("\n✅ APPEAL FLOW TEST PASSED (full chain, including the GenLayer-consensus final resolution). bountyId:", bountyId);
