import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

/**
 * useLoadState — generic async data-loading hook for QUERY (page-data)
 * fetchers. Mirrors CKQ's hook of the same name/shape (react-query-like
 * { data, error, isLoading, retry }) so a future migration to a real caching
 * library is a mechanical replacement. Deliberately has no caching, request
 * de-duplication, or automatic retries.
 *
 * Convention: fetchers passed in MUST throw on failure (see the services
 * contract in lib/services/*.ts) — a resolved value of `null`/`[]` must mean
 * only "genuinely no data", never "the request failed".
 */
export interface UseLoadStateResult<T> {
  data: T | null;
  error: unknown;
  isLoading: boolean;
  retry: () => void;
}

const GENERIC_LOAD_ERROR_MESSAGE = 'Something went wrong — please try again.';

/**
 * Extracts a display-safe error message from a query failure.
 * Returns the backend's `message` only for a 4xx status OTHER than 404 —
 * those are the validation/forbidden/not-authorized messages the backend
 * writes to be user-facing. A 404, any 5xx, or a missing/non-numeric status
 * falls back to the generic message: a 404 body is Express's raw
 * `Cannot GET /...` text and a 5xx body can be a raw stack/error string,
 * neither safe to show a user verbatim.
 */
export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const isUserFacing4xx = typeof status === 'number' && status >= 400 && status < 500 && status !== 404;

    if (isUserFacing4xx) {
      const backendMessage = err.response?.data?.message;
      if (typeof backendMessage === 'string' && backendMessage.trim().length > 0) {
        return backendMessage;
      }
    }
  }

  return GENERIC_LOAD_ERROR_MESSAGE;
}

export function useLoadState<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList
): UseLoadStateResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // Always call the latest fetcher without forcing callers to memoize it —
  // only `deps` controls when a fetch re-runs.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(
    () => {
      let cancelled = false;

      setIsLoading(true);
      setError(null);
      setData(null);

      fetcherRef
        .current()
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setIsLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err);
          setIsLoading(false);
        });

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [...deps, attempt]
  );

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  return { data, error, isLoading, retry };
}
