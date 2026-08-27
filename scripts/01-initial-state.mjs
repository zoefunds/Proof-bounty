import { read, CONTRACT_ADDRESS } from "./lib-contract.mjs";

console.log("=== PROOFBOUNTY contract initial-state audit ===");
console.log("Contract:", CONTRACT_ADDRESS);
console.log("owner:", await read("get_owner"));
console.log("treasury:", await read("get_treasury"));
console.log("default_fee_bps:", await read("get_default_fee_bps"));
console.log("is_paused:", await read("is_paused"));
console.log("bounty_counter:", await read("get_bounty_counter"));
console.log("contract_balance:", await read("get_contract_balance"));
console.log("valid_categories:", JSON.stringify(await read("get_valid_categories")));
console.log("list_bounties(0,10):", JSON.stringify(await read("list_bounties", [0, 10])));
console.log("disputed_attempts(0,10):", JSON.stringify(await read("get_disputed_attempts", [0, 10])));
