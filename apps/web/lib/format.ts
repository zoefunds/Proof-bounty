/** GEN uses 18 decimals, same as ETH — the contract stores/moves raw wei-equivalent u256 amounts. */
const GEN_DECIMALS = 18n;
const GEN_SCALE = 10n ** GEN_DECIMALS;

export function toGenWei(genAmount: string | number): bigint {
  const [whole, frac = ""] = String(genAmount).split(".");
  const paddedFrac = (frac + "0".repeat(18)).slice(0, 18);
  const wholeBig = BigInt(whole || "0");
  const fracBig = BigInt(paddedFrac || "0");
  return wholeBig * GEN_SCALE + fracBig;
}

export function fromGenWei(wei: number | bigint | string): string {
  const value = typeof wei === "bigint" ? wei : BigInt(Math.trunc(Number(wei)));
  const whole = value / GEN_SCALE;
  const frac = value % GEN_SCALE;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function formatGen(wei: number | bigint | string, opts?: { maxDecimals?: number }): string {
  const raw = fromGenWei(wei);
  const maxDecimals = opts?.maxDecimals ?? 4;
  const [whole, frac] = raw.split(".");
  const wholeFormatted = Number(whole).toLocaleString("en-US");
  if (!frac) return wholeFormatted;
  return `${wholeFormatted}.${frac.slice(0, maxDecimals)}`;
}

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
