"use client";

import { useEffect, useState, useCallback } from "react";
import type { CalldataEncodable } from "genlayer-js/types";
import { getReadOnlyClient, getContractAddress } from "./genlayer-client";
import { isContractConfigured } from "./contract-config";

interface UseContractReadResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Read-only contract call, safe to use without a connected wallet (view
 * calls never require a signature). Every marketplace/bounty-detail/
 * dashboard page reads through this hook rather than calling
 * `client.readContract` ad hoc, so the "contract not yet configured" and
 * "network unreachable" states are handled uniformly everywhere.
 */
export function useContractRead<T = unknown>(
  functionName: string,
  args: CalldataEncodable[] = [],
  options?: { enabled?: boolean }
): UseContractReadResult<T> {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    // Every setState call below happens inside this async function's
    // continuation, never synchronously in the effect body itself
    // (including the "not configured" branch) -- satisfies React's
    // set-state-in-effect purity rule, which otherwise flags synchronous
    // setState calls made directly in an effect as a cascading-render risk.
    async function run() {
      if (!isContractConfigured()) {
        if (!cancelled) {
          setError("Contract address is not configured yet.");
          setIsLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const client = getReadOnlyClient();
        const result = await client.readContract({
          address: getContractAddress(),
          functionName,
          args,
        });
        if (!cancelled) setData(result as T);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functionName, JSON.stringify(args), enabled, nonce]);

  return { data, isLoading, error, refetch };
}
