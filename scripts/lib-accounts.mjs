import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Wallet } from "ethers";
import { createAccount } from "genlayer-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYSTORE_PASSWORD = "TempTest123!";

export async function loadAccount(name) {
  const keystorePath = path.join(__dirname, "test-keys", `${name}.json`);
  const json = readFileSync(keystorePath, "utf-8");
  const wallet = await Wallet.fromEncryptedJson(json, KEYSTORE_PASSWORD);
  return { name, address: wallet.address, account: createAccount(wallet.privateKey) };
}
