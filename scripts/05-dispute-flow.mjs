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
const challenger = await loadAccount("vde-claimant");
const arbiter = await loadAccount("sac-council");
const stranger = await loadAccount("vde-contester-2");

const creatorClient = clientFor(creator.account);
const challengerClient = clientFor(challenger.account);
const arbiterClient = clientFor(arbiter.account);
const strangerClient = clientFor(stranger.account);

console.log("=== Test: dispute -> arbiter APPROVE override ===");

const { receipt: createReceipt } = await write(
  creatorClient,
  "create_bounty",
  [
    "Dispute-flow test bounty A",
    "Testing arbiter override after a REJECTED/NEEDS_REVISION verdict.",
    "POSITIVE",
    "OTHER",
    "1. The fetched page must contain the exact literal string 'zzz-dispute-test-marker-4471'.",
    "Any public URL.",
    arbiter.address,
    172800,
    Number(toGenWei("0.1")),
  ],
  toGenWei("1")
);
assert(receiptSucceeded(createReceipt), "create_bounty succeeded");
const bountyId = Number(await read("get_bounty_counter")) - 1;
console.log("bountyId:", bountyId);

await write(challengerClient, "accept_bounty", [bountyId], toGenWei("0.1"));
await write(challengerClient, "submit_evidence", [bountyId, 0, "https://genlayer.com/", "will not satisfy criteria"]);

console.log("\n-- request_verification (expect REJECTED or NEEDS_REVISION, real call) --");
const { receipt: verifyReceipt } = await write(challengerClient, "request_verification", [bountyId, 0]);
assert(receiptSucceeded(verifyReceipt), "request_verification tx succeeded");
let attempt = await read("get_attempt", [bountyId, 0]);
console.log("   verdict:", attempt.last_verdict, "| status:", attempt.status_label);

console.log("\n-- raise_dispute validation failures --");
await expectFail("empty reason", () => write(challengerClient, "raise_dispute", [bountyId, 0, ""]));
await expectFail("stranger cannot raise dispute (not creator/challenger)", () =>
  write(strangerClient, "raise_dispute", [bountyId, 0, "I have no standing here"])
);

console.log("\n-- raise_dispute (real) --");
const { receipt: disputeReceipt } = await write(challengerClient, "raise_dispute", [
  bountyId, 0, "I believe the AI verdict was too strict; my evidence substantially addresses the claim.",
]);
assert(receiptSucceeded(disputeReceipt), "raise_dispute succeeded");
attempt = await read("get_attempt", [bountyId, 0]);
assert(attempt.status_label === "DISPUTED", "attempt status is DISPUTED");

console.log("\n-- resolve_dispute access control --");
await expectFail("non-arbiter cannot resolve_dispute", () =>
  write(strangerClient, "resolve_dispute", [bountyId, 0, "APPROVE", "not the arbiter", 0])
);

console.log("\n-- resolve_dispute APPROVE (real arbiter override) --");
const { receipt: resolveReceipt } = await write(arbiterClient, "resolve_dispute", [
  bountyId, 0, "APPROVE", "Arbiter reviewed manually and considers the submission substantially compliant.", 0,
]);
assert(receiptSucceeded(resolveReceipt), "resolve_dispute APPROVE succeeded");

attempt = await read("get_attempt", [bountyId, 0]);
assert(attempt.status_label === "WON", "attempt status is WON after arbiter APPROVE");
assert(attempt.resolved_by_arbiter === true, "resolved_by_arbiter flag is true");

const bounty = await read("get_bounty", [bountyId]);
assert(bounty.status_label === "SETTLED", "bounty status is SETTLED via arbiter override");

console.log("\n✅ DISPUTE APPROVE TEST PASSED. bountyId:", bountyId);
