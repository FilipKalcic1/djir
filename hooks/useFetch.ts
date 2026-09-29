import { useAuth } from "@clerk/clerk-expo";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAPI } from "@/services/api";

/**
 * Load `url` (JSON with a `data` field). Pass `null` to skip the request, e.g.
 * until the user is known. `authenticated` sends a fresh Clerk session token;
 * `timeoutMs` turns a request with no answer into an error (fetchAPI).
 * A response for an outdated url, or after unmount, is ignored (R40).
 */
export function useFetch<T, Body extends { data: T } = { data: T }>(
  url: string | null,
  {
    authenticated = false,
    timeoutMs,
  }: { authenticated?: boolean; timeoutMs?: number } = {},
) {
  const { getToken } = useAuth();
  const [body, setBody] = useState<Body | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchData = useCallback(async () => {
    if (url === null) {
      // Nothing to load (e.g. signed out): no data from a previous url, not loading.
      setBody(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const token = authenticated ? await getToken() : null;
      const result = await fetchAPI<Body>(url, { token, timeoutMs });
      if (id === requestId.current) setBody(result);
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [url, authenticated, timeoutMs, getToken]);

  useEffect(() => {
    fetchData();
    const current = requestId;
    return () => {
      current.current++; // unmounted or url changed: drop in-flight results
    };
  }, [fetchData]);

  return { data: body?.data ?? null, body, loading, error, refetch: fetchData };
}
