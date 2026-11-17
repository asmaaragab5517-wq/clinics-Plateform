'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { get, pGet } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (d: T | undefined) => void;
}

/** GET a BFF path; `null` disables the request. */
export function useApi<T>(path: string | null, platform = false): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (platform ? pGet<T> : get<T>)(path, ac.signal).then(
      (d) => {
        setData(d);
        setLoading(false);
      },
      (e: unknown) => {
        if ((e as Error)?.name === 'AbortError') return;
        setError(e);
        setLoading(false);
      },
    );
    return () => ac.abort();
  }, [path, n, platform]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, loading, reload, setData };
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Live updates over SSE (through the BFF). Calls `onEvent` for each message; reconnects automatically. */
export function useEventSource(url: string | null, onEvent: (data: unknown) => void) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!url || typeof EventSource === 'undefined') return;
    const es = new EventSource(url, { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        ref.current(JSON.parse(m.data as string));
      } catch {
        ref.current(null);
      }
    };
    return () => {
      es.close();
      setConnected(false);
    };
  }, [url]);
  return connected;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setV(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);
  const save = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, save];
}
