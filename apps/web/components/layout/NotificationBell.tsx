"use client";

/**
 * In-app notification bell, polling the backend indexer's per-recipient
 * Notification table (apps/api/src/routes/notifications.ts). This is
 * polling-based, not push/email/webhook -- see memory/MEMORY.md for that
 * explicit scope boundary. Gracefully renders nothing if the wallet isn't
 * connected or the backend is unreachable (never a hard dependency,
 * matching the rest of the app's cache-is-optional design).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet-context";
import { api, isApiConfigured, type NotificationItem } from "@/lib/api-client";
import { formatTimestamp } from "@/lib/format";

const POLL_INTERVAL_MS = 25_000;

export function NotificationBell() {
  const { address } = useWallet();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!address || !isApiConfigured()) return;
    try {
      const res = await api.getNotifications(address, false);
      setItems(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      // Backend unreachable — fail silently, this is a convenience feature.
    }
  }, [address]);

  useEffect(() => {
    // No synchronous setState here when `address` is falsy: the component
    // itself renders `null` in that case (see the early return below), so
    // there's nothing that would observe stale `items`/`unreadCount` — the
    // next successful `refresh()` after reconnecting simply overwrites them.
    if (!address) return;
    // Dispatch the initial fetch via a timer callback (same shape as the
    // recurring `setInterval` below) rather than calling the setState-
    // triggering `refresh()` directly and synchronously in the effect body.
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [address, refresh]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleOpen() {
    setOpen((prev) => !prev);
  }

  async function handleMarkAllRead() {
    if (!address) return;
    await api.markAllNotificationsRead(address);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  async function handleItemClick(item: NotificationItem) {
    if (!item.read) {
      await api.markNotificationRead(item.id);
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  }

  if (!address) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative w-9 h-9 flex items-center justify-center rounded-md border border-border-subtle bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-status-rejected text-white text-[9px] font-mono-data flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-border-subtle bg-deep-navy shadow-2xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle sticky top-0 bg-deep-navy">
            <span className="font-mono-data text-[11px] uppercase tracking-wide text-on-surface-variant">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="font-body text-[11px] text-electric-blue hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center font-body text-xs text-on-surface-variant">
              Nothing yet — activity on your bounties and attempts will show up here.
            </div>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/bounty/${item.bountyId}`}
                    onClick={() => handleItemClick(item)}
                    className={`block px-4 py-3 border-b border-border-subtle hover:bg-surface-container-high transition-colors ${
                      item.read ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!item.read && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-action-green shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-body text-xs text-on-surface font-medium">{item.title}</div>
                        <div className="font-body text-[11px] text-on-surface-variant mt-0.5">{item.body}</div>
                        <div className="font-mono-data text-[10px] text-on-surface-variant/60 mt-1">
                          {formatTimestamp(Math.floor(new Date(item.createdAt).getTime() / 1000))}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C10.34 2 9 3.34 9 5V5.29C6.44 6.06 4.5 8.44 4.5 11.25V16L2.5 19H21.5L19.5 16V11.25C19.5 8.44 17.56 6.06 15 5.29V5C15 3.34 13.66 2 12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9.5 21.5C9.5 22.6 10.68 23.5 12 23.5C13.32 23.5 14.5 22.6 14.5 21.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
