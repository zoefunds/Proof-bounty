import { loadAccount } from "./lib-accounts.mjs";
import { read } from "./lib-contract.mjs";

const actors = {
  creator_dv_buyer: "dv-buyer",
  challenger_A_vde_claimant: "vde-claimant",
  challenger_B_dv_seller: "dv-seller",
  challenger_vde_contester: "vde-contester",
  arbiter_sac_council: "sac-council",
};

console.log("=== get_reputation across every real test actor ===");
for (const [label, name] of Object.entries(actors)) {
  const { address } = await loadAccount(name);
  const rep = await read("get_reputation", [address]);
  console.log(`\n${label} (${address}):`);
  console.log("  bounties_created:", rep.bounties_created);
  console.log("  bounties_funded_total:", rep.bounties_funded_total);
  console.log("  attempts_made:", rep.attempts_made);
  console.log("  attempts_won:", rep.attempts_won);
  console.log("  attempts_partial:", rep.attempts_partial);
  console.log("  attempts_rejected:", rep.attempts_rejected);
  console.log("  attempts_disputed:", rep.attempts_disputed);
  console.log("  total_earned:", rep.total_earned);
}

console.log("\n=== final protocol-wide state ===");
console.log("bounty_counter:", await read("get_bounty_counter"));
const all = await read("list_bounties", [0, 50]);
console.log(`\nAll ${all.length} bounties:`);
for (const b of all) {
  console.log(`  #${b.bounty_id} [${b.status_label}] "${b.title}" reward=${b.reward_amount} attempts=${b.attempt_count}`);
}
