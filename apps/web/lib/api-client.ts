/**
 * Client for the PROOFBOUNTY backend indexer (apps/api). This is a CACHE
 * over the contract's own state — never authoritative (see
 * apps/api/prisma/schema.prisma header). Every page that reads through
 * this client must be comfortable with data that's a few seconds to
 * `INDEXER_POLL_INTERVAL_MS` stale; anything payment-critical (accepting a
 * bounty, checking exact escrow amounts before signing) always reads
 * directly from the contract instead (lib/use-contract-read.ts).
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export function isApiConfigured(): boolean {
  return API_URL.length > 0;
}

async function apiFetch<T>(path: string): Promise<T> {
  if (!isApiConfigured()) throw new Error("Backend API is not configured.");
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listBounties: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return apiFetch<{ items: unknown[]; total: number }>(`/bounties${qs ? `?${qs}` : ""}`);
  },
  getBounty: (id: number) => apiFetch<unknown>(`/bounties/${id}`),
  getAttemptsByChallenger: (address: string) =>
    apiFetch<{ items: unknown[] }>(`/attempts?challenger=${encodeURIComponent(address)}`),
  getBountyAttempts: (id: number) => apiFetch<{ items: unknown[] }>(`/bounties/${id}/attempts`),
  getEvidenceArchives: (bountyId: number, attemptIndex: number) =>
    apiFetch<{ items: EvidenceArchiveItem[] }>(
      `/bounties/${bountyId}/attempts/${attemptIndex}/evidence-archive`
    ),
  getDisputes: () => apiFetch<{ items: unknown[] }>(`/disputes`),
  getReputation: (address: string) => apiFetch<unknown>(`/reputation/${address}`),
  getActivity: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch<{ items: unknown[] }>(`/activity${qs ? `?${qs}` : ""}`);
  },
  getNotifications: (address: string, unreadOnly = false) =>
    apiFetch<{ items: NotificationItem[]; unreadCount: number }>(
      `/notifications?address=${encodeURIComponent(address)}&unreadOnly=${unreadOnly}`
    ),
  markNotificationRead: async (id: string) => {
    if (!isApiConfigured()) return;
    await fetch(`${API_URL}/notifications/${id}/read`, { method: "POST" });
  },
  markAllNotificationsRead: async (address: string) => {
    if (!isApiConfigured()) return;
    await fetch(`${API_URL}/notifications/read-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
  },
};

export interface EvidenceArchiveItem {
  id: string;
  url: string;
  contentSha256: string;
  contentType: string;
  byteLength: number;
  truncated: boolean;
  fetchedAt: string;
  fetchError: string | null;
  localContentDigest: string;
  onChainHashMatch: boolean | null;
  onChainHashCheckedAt: string | null;
}

export interface NotificationItem {
  id: string;
  recipient: string;
  kind: string;
  bountyId: number;
  attemptIndex: number | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}
