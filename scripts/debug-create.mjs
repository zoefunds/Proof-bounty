import { loadAccount } from "./lib-accounts.mjs";
import { clientFor, toGenWei } from "./lib-contract.mjs";
import { CONTRACT_ADDRESS } from "./lib-contract.mjs";

const creator = await loadAccount("dv-buyer");
const client = clientFor(creator.account);

const hash = await client.writeContract({
  address: CONTRACT_ADDRESS,
  functionName: "create_bounty",
  args: [
    "Prove GenLayer's own docs mention validator consensus",
    "The official GenLayer documentation homepage describes a consensus mechanism among validators.",
    "POSITIVE",
    "DOCUMENTATION",
    "1. The fetched page must mention the word 'consensus'.\n2. The fetched page must mention 'validator' or 'validators'.",
    "A public URL to GenLayer's own documentation or homepage.",
    creator.address,
    172800,
    Number(toGenWei("0.1")),
  ],
  value: toGenWei("2"),
});
console.log("hash:", hash);
const receipt = await client.waitForTransactionReceipt({ hash, retries: 60, interval: 3000 });
console.log(JSON.stringify(receipt, (k, v) => typeof v === "bigint" ? v.toString() : v, 2).slice(0, 3000));
