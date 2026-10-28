/** Base Sepolia USDC uses six decimals. Amounts are always raw base units. */
const USDC_DECIMALS = 6n;
const USDC_SCALE = 10n ** USDC_DECIMALS;

/**
 * Must match `VERIFICATION_GRACE_SECONDS` in contracts/proof_bounty.py --
 * `claim_creator_timeout` only accepts once `deadline + this` has passed,
 * not at `deadline` alone. Duplicated here (rather than fetched from the
 * contract) since it's a compile-time constant on-chain; keep both in
 * sync if the contract's value ever changes.
 */
export const VERIFICATION_GRACE_SECONDS = 24 * 3600;

export function toUsdcUnits(usdcAmount: string | number): bigint {
  const [whole, frac = ""] = String(usdcAmount).split(".");
  const paddedFrac = (frac + "0".repeat(6)).slice(0, 6);
  const wholeBig = BigInt(whole || "0");
  const fracBig = BigInt(paddedFrac || "0");
  return wholeBig * USDC_SCALE + fracBig;
}

export function fromUsdcUnits(units: number | bigint | string): string {
  const value = typeof units === "bigint" ? units : BigInt(String(units));
  const whole = value / USDC_SCALE;
  const frac = value % USDC_SCALE;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function formatUsdc(units: number | bigint | string, opts?: { maxDecimals?: number }): string {
  const raw = fromUsdcUnits(units);
  const maxDecimals = opts?.maxDecimals ?? 4;
  const [whole, frac] = raw.split(".");
  const wholeFormatted = Number(whole).toLocaleString("en-US");
  if (!frac) return wholeFormatted;
  return `${wholeFormatted}.${frac.slice(0, maxDecimals)}`;
}

/** Compatibility aliases while callers migrate naming; both are USDC units. */
export const toGenWei = toUsdcUnits;
export const fromGenWei = fromUsdcUnits;
export const formatGen = formatUsdc;

export function formatDeadline(unixSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = unixSeconds - now;
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}D ${hours}H LEFT`;
  const minutes = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}H ${minutes}M LEFT`;
  return `${minutes}M LEFT`;
}

export function isExpired(unixSeconds: number): boolean {
  return unixSeconds * 1000 < Date.now();
}

export function formatTimestamp(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function truncateAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}
