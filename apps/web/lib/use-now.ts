"use client";

import { useEffect, useState } from "react";

/**
 * Current time in unix seconds, as React state — never call `Date.now()`
 * directly during render (React's purity rules correctly flag that as an
 * impure call: two renders of the same component could see different
 * values with no state change to explain why). This hook is the compliant
 * replacement: it reads the time once on mount and refreshes on an
 * interval, so any deadline/countdown comparison re-renders naturally
 * instead of silently going stale.
 */
export function useNow(refreshMs = 15_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), refreshMs);
    return () => clearInterval(interval);
  }, [refreshMs]);

  return now;
}
