/**
 * Single-command reviewer runbook. Verifies, against live StudioNet, that
 * the deployed contract is what this repo claims it is, and reports the
 * critical read-side state a reviewer would otherwise have to gather by
 * hand. Does NOT execute any write transaction and does NOT need a
 * funded account -- it is safe to run with zero setup beyond `npm install`
 * in this directory.
 *
 * Usage:
 *   node 00-reviewer-verify.mjs
 *
 * For the write-path lifecycle proof (real bounty creation, evidence
 * submission, verification, dispute, appeal), see scripts/10 through 13
 * (realistic, non-placeholder content, run against live StudioNet) and
 * `gltest tests/integration -v -s --network studionet --chain-type studionet`
 * for the automated suite (drop `-m "not llm"` is not needed here -- that
 * flag excludes the one LLM-dependent test from ROUTINE runs; include it
 * explicitly if you want that path too).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CONTRACT_ADDRESS, read } from "./lib-contract.mjs";

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function ok(label, detail = "") {
  console.log(`  ✓ ${label}${detail ? " -- " + detail : ""}`);
}

function fail(label, detail = "") {
  console.log(`  ✗ ${label}${detail ? " -- " + detail : ""}`);
  process.exitCode = 1;
}

section("Deployed address");
console.log(`  ${CONTRACT_ADDRESS}`);

section("Bytecode/source match");
try {
  const deployedSource = execSync(`genlayer code ${CONTRACT_ADDRESS} 2>/dev/null`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const localSource = readFileSync(new URL("../contracts/proof_bounty.py", import.meta.url), "utf-8");
  // The CLI wraps the raw source with a few banner/status lines -- strip
  // those before comparing, rather than doing a byte-for-byte diff of CLI
  // chrome that was never part of the contract itself.
  const deployedLines = deployedSource
    .split("\n")
    .filter((l) => !l.startsWith("[genlayer-js]") && !l.startsWith("- Getting code") && l !== "Result:" && !l.startsWith("✔"));
  const deployedTrimmed = deployedLines.join("\n").trim();
  const localTrimmed = localSource.trim();
  if (deployedTrimmed === localTrimmed) {
    ok("deployed bytecode's source matches contracts/proof_bounty.py exactly");
  } else {
    fail(
      "deployed source DIFFERS from contracts/proof_bounty.py",
      "the live contract does not reflect the current repo -- redeploy required (see docs/DEPLOYMENT.md)"
    );
  }
} catch (err) {
  fail("could not fetch deployed source via `genlayer code`", err.message?.slice(0, 200));
}

section("Critical read methods");
const reads = [
  ["get_bounty_counter", []],
  ["get_contract_balance", []],
  ["get_valid_categories", []],
  ["get_settlement_transparency", []],
  ["list_bounties", [0, 10]],
  ["get_disputed_attempts", [0, 10]],
];
for (const [method, args] of reads) {
  try {
    const result = await read(method, args);
    ok(method, JSON.stringify(result).slice(0, 200));
  } catch (err) {
    fail(method, err.message?.slice(0, 200));
  }
}

section("Settlement transparency (arbiter/appeal-tier bounding evidence)");
try {
  const transparency = await read("get_settlement_transparency", []);
  console.log(`  AI-consensus-decided settlements: ${transparency.attempts_settled_by_ai_consensus}`);
  console.log(`  Human-override settlements:       ${transparency.attempts_settled_by_human_override}`);
  console.log(`  Total settled attempts:           ${transparency.total_settled_attempts}`);
  console.log(`  Human override rate:              ${(Number(transparency.human_override_rate_bps) / 100).toFixed(2)}%`);
} catch (err) {
  fail("get_settlement_transparency", err.message?.slice(0, 200));
}

section("Lifecycle test coverage (not run here -- see docs/CONTRACT_REVIEW.md)");
console.log("  Automated (34 tests): gltest tests/integration -v -s --network studionet --chain-type studionet");
console.log("  Manual live scripts:  node 01-initial-state.mjs ... node 13-product-test-d-cancel-and-partial.mjs");
console.log("  Full invariant-to-test map: docs/CONTRACT_REVIEW.md");

section("Summary");
if (process.exitCode === 1) {
  console.log("  Some checks FAILED -- see ✗ marks above.");
} else {
  console.log("  All automated checks passed. This is read-side verification only;");
  console.log("  run the test suite and/or scripts/01-13 for full write-path proof.");
}
