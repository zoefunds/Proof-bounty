import { loadAccount } from "./lib-accounts.mjs";

for (const name of ["dv-buyer", "dv-seller", "sac-council", "vde-claimant", "vde-contester", "vde-contester-2"]) {
  const { address } = await loadAccount(name);
  console.log(name, "->", address);
}
