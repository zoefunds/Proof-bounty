"use client";

import { BrowserProvider, Contract, MaxUint256 } from "ethers";
import { useAppKitProvider } from "@reown/appkit-controllers/react";
import type { EthereumProvider } from "./genlayer-client";
import { BASE_ESCROW_ADDRESS, BASE_SEPOLIA_CHAIN_ID, BASE_USDC_ADDRESS } from "./contract-config";

const ERC20_ABI = ["function approve(address spender,uint256 amount) returns (bool)"];
const ESCROW_ABI = [
  "function fundBounty(uint256 bountyId,uint256 reward,uint256 requiredBond,uint16 feeBps)",
  "function fundAttempt(uint256 bountyId,uint256 reservationId,uint64 authorizationExpiry,bytes authorization)",
  "function recoverPendingAttempt(uint256 bountyId,uint256 reservationId)",
  "function recoverOrphanBounty(uint256 bountyId)",
  "function fundAppeal(uint256 bountyId,uint256 attemptIndex)",
  "function claim()",
  "function claimable(address account) view returns (uint256)",
];

async function switchToBase(provider: EthereumProvider) {
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${BASE_SEPOLIA_CHAIN_ID.toString(16)}` }] });
}

export function useBaseEscrow() {
  const { walletProvider } = useAppKitProvider<EthereumProvider>("eip155");

  async function contracts() {
    if (!walletProvider) throw new Error("Connect your wallet first.");
    if (!BASE_ESCROW_ADDRESS) throw new Error("Base escrow is not configured.");
    await switchToBase(walletProvider);
    const signer = await new BrowserProvider(walletProvider).getSigner();
    return {
      token: new Contract(BASE_USDC_ADDRESS, ERC20_ABI, signer),
      escrow: new Contract(BASE_ESCROW_ADDRESS, ESCROW_ABI, signer),
    };
  }

  async function approve() {
    const { token } = await contracts();
    await (await token.approve(BASE_ESCROW_ADDRESS, MaxUint256)).wait();
  }

  return {
    approve,
    fundBounty: async (id: number, reward: bigint, bond: bigint, feeBps: number) => {
      const { escrow } = await contracts();
      await (await escrow.fundBounty(id, reward, bond, feeBps)).wait();
    },
    fundAttempt: async (id: number, reservationId: number, authorizationExpiry: number, authorization: string) => {
      const { escrow } = await contracts();
      const tx = await escrow.fundAttempt(id, reservationId, authorizationExpiry, authorization);
      await tx.wait();
      return String(tx.hash);
    },
    recoverPendingAttempt: async (id: number, reservationId: number) => {
      const { escrow } = await contracts();
      await (await escrow.recoverPendingAttempt(id, reservationId)).wait();
    },
    recoverOrphanBounty: async (id: number) => {
      const { escrow } = await contracts();
      await (await escrow.recoverOrphanBounty(id)).wait();
    },
    fundAppeal: async (id: number, index: number) => {
      const { escrow } = await contracts();
      await (await escrow.fundAppeal(id, index)).wait();
    },
    claim: async () => {
      const { escrow } = await contracts();
      await (await escrow.claim()).wait();
    },
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Base reconciliation request failed");
  return payload as T;
}

export function requestAttemptFundingAuthorization(bountyId: number, reservationId: number, challenger: string) {
  return post<{ authorization: string; authorizationExpiry: number; bond: string }>("/base/funding-authorization", { bountyId, reservationId, challenger });
}

export function confirmAttemptFunding(bountyId: number, reservationId: number, challenger: string, baseFundingTxHash: string) {
  return post<{ attemptIndex: number; genlayerTxHash: string; baseBindingTxHash: string | null; alreadyBound: boolean }>("/base/funding-confirmation", { bountyId, reservationId, challenger, baseFundingTxHash });
}
