import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().default(8080),
  PROOFBOUNTY_CONTRACT_ADDRESS: z.string().min(1, "PROOFBOUNTY_CONTRACT_ADDRESS is required"),
  GENLAYER_RPC_URL: z.string().url().default("https://studio.genlayer.com/api"),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().default(15_000),
  CORS_ORIGIN: z.string().default("https://proof-bounty.vercel.app"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  REDIS_URL: z.string().min(1).optional(),
  GENLAYER_RPC_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(30),
  // Confirmed live against StudioNet (2026-08-25): the per-minute cap is
  // NOT the only ceiling -- a separate, stricter 500-requests-per-hour cap
  // also applies and was hit in production by ordinary indexer polling
  // once the marketplace had a realistic number of bounties. 30/min sustained
  // continuously would be 1800/hour, nearly 4x over budget -- the per-minute
  // pacer alone is insufficient; both windows must be enforced.
  GENLAYER_RPC_RATE_LIMIT_PER_HOUR: z.coerce.number().default(480), // small safety margin under the real 500 cap
  // Confirmed live 2026-08-26: StudioNet enforces a THIRD, daily cap on top
  // of the per-minute and per-hour ones (surfaced as "Rate limit exceeded:
  // 5000 requests per day" once the hourly fix let volume climb). Same
  // safety-margin pattern as the hourly limit.
  GENLAYER_RPC_RATE_LIMIT_PER_DAY: z.coerce.number().default(4800),
  BASE_SEPOLIA_RPC_URL: z.string().url().default("https://sepolia.base.org"),
  BASE_ESCROW_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  BASE_RELAYER_PRIVATE_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional(),
  BASE_DECISION_SIGNER_PRIVATE_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional(),
  BASE_RELAY_INTERVAL_MS: z.coerce.number().default(120_000),
});

export const env = envSchema.parse(process.env);
