"use client";

import { BrowserProvider, Contract, MaxUint256 } from "ethers";
import { useAppKitProvider } from "@reown/appkit-controllers/react";
import type { EthereumProvider } from "./genlayer-client";
import { BASE_ESCROW_ADDRESS, BASE_SEPOLIA_CHAIN_ID, BASE_USDC_ADDRESS } from "./contract-config";

const ERC20_ABI = ["function approve(address spender,uint256 amount) returns (bool)"];
const ESCROW_ABI = [
  "function fundBounty(uint256 bountyId,uint256 reward,uint256 requiredBond,uint16 feeBps)",
  "function fundAttempt(uint256 bountyId,uint256 attemptIndex)",
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
    fundAttempt: async (id: number, index: number) => {
      const { escrow } = await contracts();
      await (await escrow.fundAttempt(id, index)).wait();
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
