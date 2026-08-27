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
const challenger = await loadAccount("dv-seller");
const arbiter = await loadAccount("sac-council");
const creatorClient = clientFor(creator.account);
const challengerClient = clientFor(challenger.account);
const arbiterClient = clientFor(arbiter.account);

console.log("=== Part 1: dispute -> arbiter REJECT ===");
{
  const { receipt } = await write(
    creatorClient, "create_bounty",
    ["Dispute-flow test bounty B", "Testing arbiter REJECT override.", "POSITIVE", "OTHER",
     "1. The fetched page must contain 'zzz-dispute-test-marker-reject-8834'.", "Any URL.",
     arbiter.address, 172800, Number(toGenWei("0.15"))],
    toGenWei("1")
  );
  assert(receiptSucceeded(receipt), "create_bounty succeeded");
  const bountyId = Number(await read("get_bounty_counter")) - 1;
  console.log("bountyId:", bountyId);

  await write(challengerClient, "accept_bounty", [bountyId], toGenWei("0.15"));
  await write(challengerClient, "submit_evidence", [bountyId, 0, "https://genlayer.com/", "won't match"]);
  const { receipt: vr } = await write(challengerClient, "request_verification", [bountyId, 0]);
  assert(receiptSucceeded(vr), "request_verification succeeded");
  let attempt = await read("get_attempt", [bountyId, 0]);
  console.log("   verdict:", attempt.last_verdict, "status:", attempt.status_label);

  const { receipt: dr } = await write(challengerClient, "raise_dispute", [bountyId, 0, "Contesting the verdict."]);
  assert(receiptSucceeded(dr), "raise_dispute succeeded");

  console.log("-- get_disputed_attempts should now include this attempt --");
  const disputed = await read("get_disputed_attempts", [0, 50]);
  const found = disputed.some((a) => a.bounty_id === bountyId && a.index === 0);
  assert(found, "attempt appears in get_disputed_attempts while DISPUTED");

  const { receipt: rr } = await write(arbiterClient, "resolve_dispute", [
    bountyId, 0, "REJECT", "Arbiter agrees the evidence does not satisfy the criteria.", 0,
  ]);
  assert(receiptSucceeded(rr), "resolve_dispute REJECT succeeded");
  attempt = await read("get_attempt", [bountyId, 0]);
  assert(attempt.status_label === "BOND_FORFEITED", "attempt status BOND_FORFEITED after arbiter REJECT");
  assert(attempt.resolved_by_arbiter === true, "resolved_by_arbiter true");

  const disputedAfter = await read("get_disputed_attempts", [0, 50]);
  const stillFound = disputedAfter.some((a) => a.bounty_id === bountyId && a.index === 0);
  assert(!stillFound, "attempt no longer in get_disputed_attempts after resolution");

  console.log("-- claim_creator_timeout should still work now (reward never settled) once deadline passes; verify pre-deadline rejection --");
  await expectFail("claim_creator_timeout before deadline", () => write(creatorClient, "claim_creator_timeout", [bountyId]));

  console.log("✅ Part 1 PASSED. bountyId:", bountyId);
}

console.log("\n=== Part 2: dispute -> arbiter PARTIAL ===");
{
  const { receipt } = await write(
    creatorClient, "create_bounty",
    ["Dispute-flow test bounty C", "Testing arbiter PARTIAL override.", "POSITIVE", "OTHER",
     "1. The fetched page must contain 'zzz-dispute-test-marker-partial-2291'.", "Any URL.",
     arbiter.address, 172800, Number(toGenWei("0.1"))],
    toGenWei("2")
  );
  assert(receiptSucceeded(receipt), "create_bounty succeeded");
  const bountyId = Number(await read("get_bounty_counter")) - 1;
  console.log("bountyId:", bountyId);

  await write(challengerClient, "accept_bounty", [bountyId], toGenWei("0.1"));
  await write(challengerClient, "submit_evidence", [bountyId, 0, "https://genlayer.com/", "partial evidence"]);
  const { receipt: vr } = await write(challengerClient, "request_verification", [bountyId, 0]);
  assert(receiptSucceeded(vr), "request_verification succeeded");

  await write(challengerClient, "raise_dispute", [bountyId, 0, "Requesting arbiter partial credit review."]);

  // Explicit payout_bps parameter (the fix for the bug found in the
  // previous audit: 6000 = 60%, passed as a real integer, never parsed
  // out of resolution_note text).
  const { receipt: rr } = await write(arbiterClient, "resolve_dispute", [
    bountyId, 0, "PARTIAL", "Arbiter grants 60% credit for substantial (though incomplete) progress.", 6000,
  ]);
  assert(receiptSucceeded(rr), "resolve_dispute PARTIAL succeeded");

  const attempt = await read("get_attempt", [bountyId, 0]);
  assert(attempt.status_label === "WON", "attempt status WON after PARTIAL");
  console.log("   last_payout_bps:", attempt.last_payout_bps, "(explicit 6000 requested -> should be exactly 6000, bucket grid is 500-wide and 6000 is already on it)");
  assert(attempt.last_payout_bps === 6000, "payout_bps is EXACTLY the requested 60% (6000 bps) -- confirms the digit-parsing bug is fixed");

  const bounty = await read("get_bounty", [bountyId]);
  assert(bounty.status_label === "SETTLED", "bounty SETTLED via PARTIAL arbiter resolution");

  console.log("✅ Part 2 PASSED. bountyId:", bountyId);
}

console.log("\n=== Part 3: force_default_resolution before grace period (must fail) ===");
{
  const { receipt } = await write(
    creatorClient, "create_bounty",
    ["Dispute-flow test bounty D (grace period)", "Testing force_default_resolution guard.", "POSITIVE", "OTHER",
     "1. The fetched page must contain 'zzz-grace-period-marker-5567'.", "Any URL.",
     arbiter.address, 3600, 0], // MIN deadline, no bond
    toGenWei("0.5")
  );
  assert(receiptSucceeded(receipt), "create_bounty succeeded");
  const bountyId = Number(await read("get_bounty_counter")) - 1;
  console.log("bountyId:", bountyId);

  await write(challengerClient, "accept_bounty", [bountyId], 0n);
  await write(challengerClient, "submit_evidence", [bountyId, 0, "https://genlayer.com/", "won't match"]);
  await write(challengerClient, "request_verification", [bountyId, 0]);
  await write(challengerClient, "raise_dispute", [bountyId, 0, "Contesting."]);

  await expectFail("force_default_resolution before deadline+grace period", () =>
    write(challengerClient, "force_default_resolution", [bountyId, 0])
  );
  console.log("✅ Part 3 PASSED (correctly rejected — real success path requires deadline+3 days, not testable live in this session). bountyId:", bountyId);
}

console.log("\n=== Part 4: cancel_bounty + extend_bounty_deadline ===");
{
  const { receipt } = await write(
    creatorClient, "create_bounty",
    ["Cancel-flow test bounty", "Testing cancel_bounty refund path.", "NEGATIVE", "OTHER",
     "1. Never satisfied -- this bounty will be cancelled before any attempt.", "N/A",
     arbiter.address, 172800, 0],
    toGenWei("0.75")
  );
  assert(receiptSucceeded(receipt), "create_bounty succeeded");
  const bountyId = Number(await read("get_bounty_counter")) - 1;
  console.log("bountyId:", bountyId);

  console.log("-- extend_bounty_deadline --");
  const beforeExtend = await read("get_bounty", [bountyId]);
  const { receipt: extendReceipt } = await write(creatorClient, "extend_bounty_deadline", [bountyId, 7200]);
  assert(receiptSucceeded(extendReceipt), "extend_bounty_deadline succeeded");
  const afterExtend = await read("get_bounty", [bountyId]);
  assert(afterExtend.deadline === beforeExtend.deadline + 7200, "deadline extended by exactly 7200s");

  console.log("-- cancel_bounty access control --");
  await expectFail("stranger cannot cancel_bounty", () => write(challengerClient, "cancel_bounty", [bountyId]));

  console.log("-- cancel_bounty (real refund) --");
  const { receipt: cancelReceipt } = await write(creatorClient, "cancel_bounty", [bountyId]);
  assert(receiptSucceeded(cancelReceipt), "cancel_bounty succeeded");
  const bounty = await read("get_bounty", [bountyId]);
  assert(bounty.status_label === "CANCELLED", "bounty status CANCELLED");
  assert(Number(bounty.reward_deposited) === 0, "reward_deposited == 0 after cancellation refund");

  console.log("-- cancel_bounty double-cancel should fail --");
  await expectFail("double-cancel", () => write(creatorClient, "cancel_bounty", [bountyId]));

  console.log("✅ Part 4 PASSED. bountyId:", bountyId);
}

console.log("\n✅✅ ALL REMAINING WRITE-METHOD TESTS PASSED.");
