import { useEffect, useState } from 'react';

/**
 * useDebouncedValue — `value`, but only after it has stopped changing for
 * `delayMs`. The one debounce in the app (docs/plans/coach-pack-pricing-
 * plan.md D14 f): the admin subscriptions search box and the coach-contract
 * pack editor's live preview both use it, so a fetch fires once per pause in
 * typing instead of on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
