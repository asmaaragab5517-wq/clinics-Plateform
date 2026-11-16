import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { OfflineError } from './api';

/**
 * Tiny data hook (no query library is installed). Refetches when the screen regains focus.
 * `fallback` supplies cached data when the network is unavailable (FR-APP-6, read-only).
 */
export function useQuery<T>(key: string | null, fn: () => Promise<T>, opts: { fallback?: () => Promise<T | null>; onData?: (d: T) => void } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!key);
  const [fromCache, setFromCache] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const load = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
      setFromCache(false);
      optsRef.current.onData?.(d);
    } catch (e) {
      const fb = e instanceof OfflineError && optsRef.current.fallback ? await optsRef.current.fallback() : null;
      if (fb != null) {
        setData(fb);
        setFromCache(true);
        setError(null);
      } else setError(e);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void load();
    }, [load]),
  );

  return { data, error, loading, fromCache, reload: load, setData };
}

/** Wrap an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
