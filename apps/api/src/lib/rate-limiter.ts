/**
 * Global pacer for outbound GenLayer RPC calls.
 *
 * StudioNet enforces THREE separate caps, all confirmed live in production
 * during this project's own real end-to-end contract testing on
 * 2026-08-25/26: 30 requests/minute, 500 requests/hour, AND 5000
 * requests/day. Each was discovered only after fixing the previous one let
 * real traffic climb high enough to hit the next ceiling -- a naive
 * per-minute-only pacer is ~3.75x over the hourly budget if sustained, and
 * the hourly fix alone still isn't enough once volume runs for a full day.
 * All three windows must be enforced together.
 *
 * Implementation:
 *   1. `RESERVE_SLOT_SCRIPT` -- an evenly-spaced-slot pacer for the
 *      per-minute window (smooths bursts instead of a bursty fixed-window
 *      counter).
 *   2. `RESERVE_FIXED_WINDOW_TOKEN_SCRIPT` -- a generic fixed-window
 *      counter, reused for both the hourly and daily budgets (a sliding
 *      pacer would mean waiting up to a full window for a single slot,
 *      unnecessary for a budget this coarse; a fixed window that resets on
 *      the hour/day, queuing a request until the next reset if exhausted,
 *      is the right shape here).
 * A caller must clear ALL THREE gates before proceeding.
 */

import { Redis } from "ioredis";
import { env } from "./env.js";

const MINUTE_KEY = "proofbounty:genlayer:rpc:next_slot";
const SLOT_TTL_MS = 120_000;

const RESERVE_SLOT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local min_interval = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local last = tonumber(redis.call('GET', key) or '0')
local next_allowed = last + min_interval
local wait = 0
if next_allowed > now then
  wait = next_allowed - now
  redis.call('SET', key, next_allowed, 'PX', ttl)
else
  redis.call('SET', key, now, 'PX', ttl)
end
return wait
`;

// Generic fixed-window counter, keyed by the current window bucket (so it
// naturally resets without a separate reset job). Returns 0 if a token was
// granted, or the number of milliseconds until the current bucket expires
// if the budget for this window is spent.
const RESERVE_FIXED_WINDOW_TOKEN_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, ttl_ms)
end
if count > limit then
  local remaining_ttl = redis.call('PTTL', key)
  if remaining_ttl < 0 then remaining_ttl = ttl_ms end
  return remaining_ttl
end
return 0
`;

const minIntervalMs = Math.ceil(60_000 / env.GENLAYER_RPC_RATE_LIMIT_PER_MINUTE);

interface FixedWindow {
  name: string;
  keyPrefix: string;
  windowMs: number;
  limit: number;
}

const HOUR_WINDOW: FixedWindow = {
  name: "hourly",
  keyPrefix: "proofbounty:genlayer:rpc:hour:",
  windowMs: 3_600_000,
  limit: env.GENLAYER_RPC_RATE_LIMIT_PER_HOUR,
};

const DAY_WINDOW: FixedWindow = {
  name: "daily",
  keyPrefix: "proofbounty:genlayer:rpc:day:",
  windowMs: 86_400_000,
  limit: env.GENLAYER_RPC_RATE_LIMIT_PER_DAY,
};

let redis: Redis | null = null;
let lastLocalCallAt = 0;
const localWindowState = new Map<string, { start: number; count: number }>();

function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    redis.on("error", (err: Error) => {
      console.error("[rate-limiter] redis error, falling back to local pacing:", err.message);
    });
  }
  return redis;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleMinuteWindow(): Promise<void> {
  const client = getRedis();
  if (client) {
    try {
      const wait = (await client.eval(
        RESERVE_SLOT_SCRIPT,
        1,
        MINUTE_KEY,
        Date.now().toString(),
        minIntervalMs.toString(),
        SLOT_TTL_MS.toString()
      )) as number;
      if (wait > 0) await sleep(wait);
      return;
    } catch (err) {
      console.error("[rate-limiter] redis eval (minute) failed, falling back to local pacing:", err);
    }
  }
  const now = Date.now();
  const nextAllowed = lastLocalCallAt + minIntervalMs;
  if (nextAllowed > now) {
    await sleep(nextAllowed - now);
    lastLocalCallAt = nextAllowed;
  } else {
    lastLocalCallAt = now;
  }
}

async function throttleFixedWindow(window: FixedWindow): Promise<void> {
  const client = getRedis();
  if (client) {
    try {
      const bucket = Math.floor(Date.now() / window.windowMs).toString();
      const key = window.keyPrefix + bucket;
      const waitMs = (await client.eval(
        RESERVE_FIXED_WINDOW_TOKEN_SCRIPT,
        1,
        key,
        window.limit.toString(),
        window.windowMs.toString()
      )) as number;
      if (waitMs > 0) {
        console.error(
          `[rate-limiter] ${window.name} GenLayer RPC budget (${window.limit}) exhausted, ` +
            `waiting ${Math.ceil(waitMs / 1000)}s for the next ${window.name} window`
        );
        await sleep(waitMs);
      }
      return;
    } catch (err) {
      console.error(`[rate-limiter] redis eval (${window.name}) failed, falling back to local pacing:`, err);
    }
  }
  const now = Date.now();
  const state = localWindowState.get(window.name) ?? { start: now, count: 0 };
  if (now - state.start >= window.windowMs) {
    state.start = now;
    state.count = 0;
  }
  state.count += 1;
  if (state.count > window.limit) {
    const waitMs = state.start + window.windowMs - now;
    if (waitMs > 0) await sleep(waitMs);
    state.start = Date.now();
    state.count = 1;
  }
  localWindowState.set(window.name, state);
}

/** Call before every outbound GenLayer RPC request. Resolves once the
 * per-minute, per-hour, AND per-day budgets all have a slot available. */
export async function throttleGenLayerCall(): Promise<void> {
  await throttleFixedWindow(DAY_WINDOW);
  await throttleFixedWindow(HOUR_WINDOW);
  await throttleMinuteWindow();
}
